// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl AndroidDeviceChannel {
    pub async fn wait(
        &self,
        params: wait_params::WaitParams,
    ) -> playwright_rs::Result<wait_result::WaitResult> {
        self.0.call("wait", params).await
    }
    pub async fn fill(
        &self,
        params: fill_params::FillParams,
    ) -> playwright_rs::Result<fill_result::FillResult> {
        self.0.call("fill", params).await
    }
    pub async fn tap(
        &self,
        params: tap_params::TapParams,
    ) -> playwright_rs::Result<tap_result::TapResult> {
        self.0.call("tap", params).await
    }
    pub async fn drag(
        &self,
        params: drag_params::DragParams,
    ) -> playwright_rs::Result<drag_result::DragResult> {
        self.0.call("drag", params).await
    }
    pub async fn fling(
        &self,
        params: fling_params::FlingParams,
    ) -> playwright_rs::Result<fling_result::FlingResult> {
        self.0.call("fling", params).await
    }
    pub async fn long_tap(
        &self,
        params: long_tap_params::LongTapParams,
    ) -> playwright_rs::Result<long_tap_result::LongTapResult> {
        self.0.call("longTap", params).await
    }
    pub async fn pinch_close(
        &self,
        params: pinch_close_params::PinchCloseParams,
    ) -> playwright_rs::Result<pinch_close_result::PinchCloseResult> {
        self.0.call("pinchClose", params).await
    }
    pub async fn pinch_open(
        &self,
        params: pinch_open_params::PinchOpenParams,
    ) -> playwright_rs::Result<pinch_open_result::PinchOpenResult> {
        self.0.call("pinchOpen", params).await
    }
    pub async fn scroll(
        &self,
        params: scroll_params::ScrollParams,
    ) -> playwright_rs::Result<scroll_result::ScrollResult> {
        self.0.call("scroll", params).await
    }
    pub async fn swipe(
        &self,
        params: swipe_params::SwipeParams,
    ) -> playwright_rs::Result<swipe_result::SwipeResult> {
        self.0.call("swipe", params).await
    }
    pub async fn info(
        &self,
        params: info_params::InfoParams,
    ) -> playwright_rs::Result<info_result::InfoResult> {
        self.0.call("info", params).await
    }
    pub async fn screenshot(
        &self,
        params: screenshot_params::ScreenshotParams,
    ) -> playwright_rs::Result<screenshot_result::ScreenshotResult> {
        self.0.call("screenshot", params).await
    }
    pub async fn input_type(
        &self,
        params: input_type_params::InputTypeParams,
    ) -> playwright_rs::Result<input_type_result::InputTypeResult> {
        self.0.call("inputType", params).await
    }
    pub async fn input_press(
        &self,
        params: input_press_params::InputPressParams,
    ) -> playwright_rs::Result<input_press_result::InputPressResult> {
        self.0.call("inputPress", params).await
    }
    pub async fn input_tap(
        &self,
        params: input_tap_params::InputTapParams,
    ) -> playwright_rs::Result<input_tap_result::InputTapResult> {
        self.0.call("inputTap", params).await
    }
    pub async fn input_swipe(
        &self,
        params: input_swipe_params::InputSwipeParams,
    ) -> playwright_rs::Result<input_swipe_result::InputSwipeResult> {
        self.0.call("inputSwipe", params).await
    }
    pub async fn input_drag(
        &self,
        params: input_drag_params::InputDragParams,
    ) -> playwright_rs::Result<input_drag_result::InputDragResult> {
        self.0.call("inputDrag", params).await
    }
    pub async fn launch_browser(
        &self,
        params: launch_browser_params::LaunchBrowserParams,
    ) -> playwright_rs::Result<launch_browser_result::LaunchBrowserResult> {
        self.0.call("launchBrowser", params).await
    }
    pub async fn open(
        &self,
        params: open_params::OpenParams,
    ) -> playwright_rs::Result<open_result::OpenResult> {
        self.0.call("open", params).await
    }
    pub async fn shell(
        &self,
        params: shell_params::ShellParams,
    ) -> playwright_rs::Result<shell_result::ShellResult> {
        self.0.call("shell", params).await
    }
}
