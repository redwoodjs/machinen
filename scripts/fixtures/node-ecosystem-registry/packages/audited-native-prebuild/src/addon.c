#include <node_api.h>
static napi_value Value(napi_env env, napi_callback_info info) {
  napi_value value;
  napi_create_string_utf8(env, "audited-native-prebuild-ok", NAPI_AUTO_LENGTH, &value);
  return value;
}
NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "value", NAPI_AUTO_LENGTH, Value, NULL, &fn);
  napi_set_named_property(env, exports, "value", fn);
  return exports;
}
