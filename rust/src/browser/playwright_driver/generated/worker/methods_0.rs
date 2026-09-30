// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl WorkerChannel {
    pub async fn disconnect(
        &self,
        params: disconnect_params::DisconnectParams,
    ) -> playwright_rs::Result<disconnect_result::DisconnectResult> {
        self.0.call("disconnect", params).await
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
