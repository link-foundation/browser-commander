// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl JSHandleChannel {
    pub async fn dispose(
        &self,
        params: dispose_params::DisposeParams,
    ) -> playwright_rs::Result<dispose_result::DisposeResult> {
        self.0.call("dispose", params).await
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
    pub async fn get_property_list(
        &self,
        params: get_property_list_params::GetPropertyListParams,
    ) -> playwright_rs::Result<get_property_list_result::GetPropertyListResult> {
        self.0.call("getPropertyList", params).await
    }
    pub async fn get_property(
        &self,
        params: get_property_params::GetPropertyParams,
    ) -> playwright_rs::Result<get_property_result::GetPropertyResult> {
        self.0.call("getProperty", params).await
    }
    pub async fn json_value(
        &self,
        params: json_value_params::JsonValueParams,
    ) -> playwright_rs::Result<json_value_result::JsonValueResult> {
        self.0.call("jsonValue", params).await
    }
}
