// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl PageChannel {
    pub async fn pick_locator(
        &self,
        params: pick_locator_params::PickLocatorParams,
    ) -> playwright_rs::Result<pick_locator_result::PickLocatorResult> {
        self.0.call("pickLocator", params).await
    }
    pub async fn cancel_pick_locator(
        &self,
        params: cancel_pick_locator_params::CancelPickLocatorParams,
    ) -> playwright_rs::Result<cancel_pick_locator_result::CancelPickLocatorResult> {
        self.0.call("cancelPickLocator", params).await
    }
    pub async fn hide_highlight(
        &self,
        params: hide_highlight_params::HideHighlightParams,
    ) -> playwright_rs::Result<hide_highlight_result::HideHighlightResult> {
        self.0.call("hideHighlight", params).await
    }
    pub async fn screencast_show_overlay(
        &self,
        params: screencast_show_overlay_params::ScreencastShowOverlayParams,
    ) -> playwright_rs::Result<screencast_show_overlay_result::ScreencastShowOverlayResult> {
        self.0.call("screencastShowOverlay", params).await
    }
    pub async fn screencast_remove_overlay(
        &self,
        params: screencast_remove_overlay_params::ScreencastRemoveOverlayParams,
    ) -> playwright_rs::Result<screencast_remove_overlay_result::ScreencastRemoveOverlayResult>
    {
        self.0.call("screencastRemoveOverlay", params).await
    }
    pub async fn screencast_chapter(
        &self,
        params: screencast_chapter_params::ScreencastChapterParams,
    ) -> playwright_rs::Result<screencast_chapter_result::ScreencastChapterResult> {
        self.0.call("screencastChapter", params).await
    }
    pub async fn screencast_set_overlay_visible(
        &self,
        params: screencast_set_overlay_visible_params::ScreencastSetOverlayVisibleParams,
    ) -> playwright_rs::Result<
        screencast_set_overlay_visible_result::ScreencastSetOverlayVisibleResult,
    > {
        self.0.call("screencastSetOverlayVisible", params).await
    }
    pub async fn screencast_show_actions(
        &self,
        params: screencast_show_actions_params::ScreencastShowActionsParams,
    ) -> playwright_rs::Result<screencast_show_actions_result::ScreencastShowActionsResult> {
        self.0.call("screencastShowActions", params).await
    }
    pub async fn screencast_hide_actions(
        &self,
        params: screencast_hide_actions_params::ScreencastHideActionsParams,
    ) -> playwright_rs::Result<screencast_hide_actions_result::ScreencastHideActionsResult> {
        self.0.call("screencastHideActions", params).await
    }
    pub async fn screencast_start(
        &self,
        params: screencast_start_params::ScreencastStartParams,
    ) -> playwright_rs::Result<screencast_start_result::ScreencastStartResult> {
        self.0.call("screencastStart", params).await
    }
    pub async fn screencast_frame_ack(
        &self,
        params: screencast_frame_ack_params::ScreencastFrameAckParams,
    ) -> playwright_rs::Result<screencast_frame_ack_result::ScreencastFrameAckResult> {
        self.0.call("screencastFrameAck", params).await
    }
    pub async fn screencast_stop(
        &self,
        params: screencast_stop_params::ScreencastStopParams,
    ) -> playwright_rs::Result<screencast_stop_result::ScreencastStopResult> {
        self.0.call("screencastStop", params).await
    }
    pub async fn update_subscription(
        &self,
        params: update_subscription_params::UpdateSubscriptionParams,
    ) -> playwright_rs::Result<update_subscription_result::UpdateSubscriptionResult> {
        self.0.call("updateSubscription", params).await
    }
    pub async fn set_dock_tile(
        &self,
        params: set_dock_tile_params::SetDockTileParams,
    ) -> playwright_rs::Result<set_dock_tile_result::SetDockTileResult> {
        self.0.call("setDockTile", params).await
    }
    pub async fn web_storage_items(
        &self,
        params: web_storage_items_params::WebStorageItemsParams,
    ) -> playwright_rs::Result<web_storage_items_result::WebStorageItemsResult> {
        self.0.call("webStorageItems", params).await
    }
    pub async fn web_storage_get_item(
        &self,
        params: web_storage_get_item_params::WebStorageGetItemParams,
    ) -> playwright_rs::Result<web_storage_get_item_result::WebStorageGetItemResult> {
        self.0.call("webStorageGetItem", params).await
    }
    pub async fn web_storage_set_item(
        &self,
        params: web_storage_set_item_params::WebStorageSetItemParams,
    ) -> playwright_rs::Result<web_storage_set_item_result::WebStorageSetItemResult> {
        self.0.call("webStorageSetItem", params).await
    }
    pub async fn web_storage_remove_item(
        &self,
        params: web_storage_remove_item_params::WebStorageRemoveItemParams,
    ) -> playwright_rs::Result<web_storage_remove_item_result::WebStorageRemoveItemResult> {
        self.0.call("webStorageRemoveItem", params).await
    }
    pub async fn web_storage_clear(
        &self,
        params: web_storage_clear_params::WebStorageClearParams,
    ) -> playwright_rs::Result<web_storage_clear_result::WebStorageClearResult> {
        self.0.call("webStorageClear", params).await
    }
}
