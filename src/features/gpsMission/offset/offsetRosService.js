import * as ROSLIB from "roslib";

export function publishOffsetTrackingRequest({ ros, publisherRef, topicName, payload }) {
  if (!publisherRef.current) {
    publisherRef.current = new ROSLIB.Topic({
      ros,
      name: topicName,
      messageType: "std_msgs/msg/String",
      queue_size: 1
    });
  }

  publisherRef.current.publish({ data: JSON.stringify(payload) });
}

export function callOffsetTrackingCancel({ ros, serviceName, onResult, onError }) {
  const service = new ROSLIB.Service({
    ros,
    name: serviceName,
    serviceType: "std_srvs/srv/Trigger"
  });

  service.callService({}, onResult, onError);
}
