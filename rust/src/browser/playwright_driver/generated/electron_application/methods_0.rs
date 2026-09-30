// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl ElectronApplicationChannel {
    pub async fn browser_window(
        &self,
        params: browser_window_params::BrowserWindowParams,
    ) -> playwright_rs::Result<browser_window_result::BrowserWindowResult> {
        self.0.call("browserWindow", params).await
    }
    pub async fn evaluate_expression(
        &self,
        params: evaluate_expression_params::EvaluateExpressionParams,
    ) -> playwright_rs::Result<evaluate_expression_result::EvaluateExpressionResult> {
        self.0.call("evaluateExpression", params).await
    }
    pub async fn evaluate_expression_handle(
        &self,
        params: evaluate_expression_handle_params::EvaluateExpressionHandleParams,
    ) -> playwright_rs::Result<evaluate_expression_handle_result::EvaluateExpressionHandleResult>
    {
        self.0.call("evaluateExpressionHandle", params).await
    }
    pub async fn update_subscription(
        &self,
        params: update_subscription_params::UpdateSubscriptionParams,
    ) -> playwright_rs::Result<update_subscription_result::UpdateSubscriptionResult> {
        self.0.call("updateSubscription", params).await
    }
}
