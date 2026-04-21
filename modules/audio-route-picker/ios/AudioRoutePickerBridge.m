#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(AudioRoutePicker, NSObject)

RCT_EXTERN_METHOD(
  presentPicker:(RCTPromiseResolveBlock)resolve
  rejecter:(RCTPromiseRejectBlock)reject
)

@end
