"""Rewrite TypeScript-style JSDoc type expressions into the Closure syntax that
jsdoc's catharsis parser accepts (`npm run docs:api` fails on the former).

    python3 experiments/issue-105/jsdoc-closure-types.py js/src/**/*.js

Arrow types become `function(T, U=): R`, optional record fields become
`(T|undefined)`, unions inside records/returns get parentheses, and
`import('x').Y` / `ReturnType<...>` / `typeof X` collapse to `Object`.
"""

import re
import sys

TAG = re.compile(r"@(param|returns?|property|type|typedef)\s*\{")


class Parser:
    def __init__(self, text):
        self.text = text
        self.pos = 0

    def peek(self, token):
        self.skip()
        return self.text.startswith(token, self.pos)

    def skip(self):
        while self.pos < len(self.text) and self.text[self.pos].isspace():
            self.pos += 1

    def eat(self, token):
        self.skip()
        if not self.text.startswith(token, self.pos):
            raise ValueError(f"expected {token!r} at {self.text[self.pos:]!r}")
        self.pos += len(token)

    def union(self):
        parts = [self.postfix()]
        while self.peek("|"):
            self.eat("|")
            parts.append(self.postfix())
        return parts

    def type(self):
        parts = self.union()
        return parts[0] if len(parts) == 1 else "(" + "|".join(parts) + ")"

    def bare_union(self):
        return "|".join(self.union())

    def postfix(self):
        base = self.primary()
        while self.peek("[]"):
            self.eat("[]")
            base = f"Array<{base}>"
        return base

    def arrow_ahead(self):
        depth = 0
        for index in range(self.pos, len(self.text)):
            char = self.text[index]
            if char in "([{<":
                depth += 1
            elif char in ")]}>":
                depth -= 1
                if depth == 0:
                    return self.text[index + 1 :].lstrip().startswith("=>")
        return False

    def primary(self):
        self.skip()
        if self.peek("(") and self.arrow_ahead():
            return self.function()
        if self.peek("("):
            self.eat("(")
            inner = self.type()
            self.eat(")")
            return inner
        if self.peek("{"):
            return self.record()
        if self.peek("'") or self.peek('"'):
            quote = self.text[self.pos]
            end = self.text.index(quote, self.pos + 1)
            self.pos = end + 1
            return "string"
        if self.peek("typeof "):
            self.eat("typeof")
            self.name()
            return "Object"
        name = self.name()
        if name == "import":
            self.eat("(")
            self.text.index(")", self.pos)
            self.pos = self.text.index(")", self.pos) + 1
            while self.peek("."):
                self.eat(".")
                self.name()
            return "Object"
        if self.peek("<"):
            self.eat("<")
            args = [self.bare_union()]
            while self.peek(","):
                self.eat(",")
                args.append(self.bare_union())
            self.eat(">")
            if name == "ReturnType":
                return "Object"
            return f"{name}<{', '.join(args)}>"
        return name

    def name(self):
        self.skip()
        match = re.compile(r"[A-Za-z_$*][\w$.]*").match(self.text, self.pos)
        if not match:
            raise ValueError(f"name expected at {self.text[self.pos:]!r}")
        self.pos = match.end()
        return match.group(0)

    def function(self):
        self.eat("(")
        params = []
        while not self.peek(")"):
            self.skip()
            if self.peek("..."):
                self.eat("...")
                self.name()
                self.eat(":")
                params.append("..." + self.type())
            else:
                self.name()
                optional = self.peek("?")
                if optional:
                    self.eat("?")
                self.eat(":")
                params.append(self.type() + ("=" if optional else ""))
            if self.peek(","):
                self.eat(",")
        self.eat(")")
        self.eat("=>")
        result = self.type()
        return f"function({', '.join(params)}): {result}"

    def record(self):
        self.eat("{")
        fields = []
        while not self.peek("}"):
            key = self.name()
            optional = self.peek("?")
            if optional:
                self.eat("?")
            self.eat(":")
            value = self.type()
            if optional:
                inner = value[1:-1] if value.startswith("(") and value.endswith(")") and "|" in value else value
                value = f"({inner}|undefined)"
            fields.append(f"{key}: {value}")
            if self.peek(","):
                self.eat(",")
        self.eat("}")
        return "{" + ", ".join(fields) + "}"


def convert(expression):
    parser = Parser(expression)
    result = parser.bare_union()
    parser.skip()
    if parser.pos != len(expression):
        raise ValueError(f"trailing {expression[parser.pos:]!r}")
    return result


def needs_rewrite(expression):
    return any(marker in expression for marker in ("=>", "?:", "import(", "ReturnType", "typeof ")) or re.search(
        r"\{[^{}]*:[^{}]*\|", expression
    ) is not None


def rewrite(source):
    out = []
    index = 0
    for match in TAG.finditer(source):
        start = match.end()
        depth = 1
        end = start
        while depth:
            if source[end] == "{":
                depth += 1
            elif source[end] == "}":
                depth -= 1
            end += 1
        expression = source[start : end - 1]
        if "\n" in expression or not needs_rewrite(expression):
            continue
        out.append(source[index:start])
        out.append(convert(expression))
        index = end - 1
    out.append(source[index:])
    return "".join(out)


if __name__ == "__main__":
    for path in sys.argv[1:]:
        with open(path, encoding="utf-8") as handle:
            source = handle.read()
        updated = rewrite(source)
        if updated != source:
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(updated)
            print("rewrote", path)
