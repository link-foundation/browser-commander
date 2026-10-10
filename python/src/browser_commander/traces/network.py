"""Opt-in, bounded network records with default credential-header redaction."""

from __future__ import annotations

import asyncio
import base64
import json
import re
from pathlib import Path
from typing import Any
from weakref import WeakKeyDictionary

PRIVATE_HEADERS = {"cookie", "set-cookie", "authorization", "proxy-authorization"}


def redact_headers(headers):
    return {
        key.lower(): "[redacted]" if key.lower() in PRIVATE_HEADERS else value
        for key, value in headers.items()
    }


class NetworkRecorder:
    def __init__(self, page, options, record, note):
        self.page, self.options, self.record, self.note = (
            page,
            ({} if options is True else options or {}),
            record,
            note,
        )
        self.enabled = options is not None and options is not False
        self.limit = self.options.get(
            "max_body_bytes", self.options.get("maxBodyBytes", 1024 * 1024)
        )
        if not isinstance(self.limit, int) or not 0 <= self.limit <= 16 * 1024 * 1024:
            raise ValueError("network max_body_bytes must be between 0 and 16 MiB")
        if self.enabled and not callable(getattr(page, "on", None)):
            raise ValueError(
                "network tracing requires an engine with request/response events"
            )
        self.ids: WeakKeyDictionary[Any, int] = WeakKeyDictionary()
        self.pending: set[asyncio.Task[Any]] = set()
        self.sequence = 0

    def start(self):
        if self.enabled:
            self.page.on("request", self.request)
            self.page.on("response", self.response)

    def details(self, request):
        return {
            "requestId": self.ids[request],
            "method": request.method,
            "url": request.url,
            "resourceType": request.resource_type,
            "timing": request.timing,
        }

    def request(self, request):
        kinds = self.options.get("resource_types", self.options.get("resourceTypes"))
        pattern = self.options.get("url_pattern", self.options.get("urlPattern"))
        if kinds and request.resource_type not in kinds:
            return
        if pattern and not (
            pattern(request.url)
            if callable(pattern)
            else pattern.search(request.url)
            if isinstance(pattern, re.Pattern)
            else str(pattern) in request.url
        ):
            return
        self.sequence += 1
        self.ids[request] = self.sequence
        payload = {**self.details(request), "headers": redact_headers(request.headers)}
        if (
            self.options.get("bodies")
            and request.resource_type in {"document", "xhr", "fetch"}
            and request.post_data_buffer
        ):
            data = request.post_data_buffer
            payload["postData"] = data[: self.limit].decode("utf8", errors="replace")
            payload["postDataTruncated"] = len(data) > self.limit
        self.record("network.request", payload)

    def body(self, data):
        return {
            "size": len(data),
            "truncated": len(data) > self.limit,
            "data": base64.b64encode(data[: self.limit]).decode("ascii"),
        }

    def response(self, response):
        if response.request not in self.ids:
            return
        if len(self.pending) >= 32:
            headers = redact_headers(response.headers)
            self.record(
                "network.response",
                {
                    **self.details(response.request),
                    "headers": headers,
                    "status": response.status,
                    "statusText": response.status_text,
                    "contentType": headers.get("content-type"),
                    "bodyOmitted": "concurrency limit",
                },
            )
            return
        task = asyncio.create_task(self.capture(response))
        self.pending.add(task)
        task.add_done_callback(self.pending.discard)

    async def capture(self, response):
        try:
            headers = redact_headers(
                await asyncio.wait_for(response.all_headers(), timeout=5)
            )
            payload = {
                **self.details(response.request),
                "headers": headers,
                "status": response.status,
                "statusText": response.status_text,
                "contentType": headers.get("content-type"),
            }
            if self.options.get("bodies") and response.request.resource_type in {
                "document",
                "xhr",
                "fetch",
            }:
                length = int(headers.get("content-length", "0"))
                if length > self.limit:
                    payload["body"] = {"size": length, "truncated": True, "data": ""}
                else:
                    try:
                        payload["body"] = self.body(
                            await asyncio.wait_for(response.body(), timeout=5)
                        )
                    except Exception as error:
                        payload["bodyError"] = str(error)
            self.record("network.response", payload)
        except Exception as error:
            self.note(f"network capture failed: {error}")

    async def stop(self):
        if self.enabled:
            self.page.remove_listener("request", self.request)
            self.page.remove_listener("response", self.response)
        await asyncio.gather(*self.pending)


def write_har(root, events, target=None):
    requests = {
        item["requestId"]: item for item in events if item["kind"] == "network.request"
    }

    def headers(value):
        return [{"name": key, "value": str(item)} for key, item in value.items()]

    entries = []
    for response in (item for item in events if item["kind"] == "network.response"):
        request = requests.get(response["requestId"], response)
        body = response.get("body", {})
        timing = response.get("timing") or {}
        entries.append(
            {
                "startedDateTime": request["at"],
                "time": max(0, timing.get("responseEnd", 0)),
                "request": {
                    "method": request["method"],
                    "url": request["url"],
                    "httpVersion": "HTTP/1.1",
                    "headers": headers(request.get("headers", {})),
                    "cookies": [],
                    "queryString": [],
                    "headersSize": -1,
                    "bodySize": -1,
                    **(
                        {
                            "postData": {
                                "mimeType": request.get("headers", {}).get(
                                    "content-type", ""
                                ),
                                "text": request["postData"],
                                "_truncated": request.get("postDataTruncated", False),
                            }
                        }
                        if "postData" in request
                        else {}
                    ),
                },
                "response": {
                    "status": response["status"],
                    "statusText": response.get("statusText", ""),
                    "httpVersion": "HTTP/1.1",
                    "headers": headers(response.get("headers", {})),
                    "cookies": [],
                    "redirectURL": "",
                    "headersSize": -1,
                    "bodySize": body.get("size", -1),
                    "content": {
                        "size": body.get("size", 0),
                        "mimeType": response.get("contentType") or "",
                        **(
                            {
                                "text": body["data"],
                                "encoding": "base64",
                                "_truncated": body["truncated"],
                            }
                            if body
                            else {}
                        ),
                    },
                },
                "cache": {},
                "timings": {
                    "send": 0,
                    "wait": max(
                        0,
                        timing.get("responseStart", 0) - timing.get("requestStart", 0),
                    ),
                    "receive": max(
                        0, timing.get("responseEnd", 0) - timing.get("responseStart", 0)
                    ),
                },
                "_resourceType": response["resourceType"],
            }
        )
    file = Path(target or Path(root) / "network.har")
    file.write_text(
        json.dumps(
            {
                "log": {
                    "version": "1.2",
                    "creator": {"name": "browser-commander", "version": "1"},
                    "entries": entries,
                }
            }
        ),
        encoding="utf8",
    )
    file.chmod(0o600)
    return str(file)
