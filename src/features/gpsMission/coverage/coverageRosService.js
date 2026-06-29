import * as ROSLIB from "roslib";

export function publishCoveragePolygon({ ros, topicName, payload }) {
  const topic = new ROSLIB.Topic({
    ros,
    name: topicName,
    messageType: "std_msgs/msg/String",
    queue_size: 1,
  });

  topic.publish({ data: JSON.stringify(payload) });
  setTimeout(() => {
    try {
      topic.unadvertise();
    } catch (e) {
      console.warn("[GPSMissionPlanner] coverage topic unadvertise error:", e);
    }
  }, 500);
}

export function callCoverageStart({ ros, serviceName, onResult, onError }) {
  const service = new ROSLIB.Service({
    ros,
    name: serviceName,
    serviceType: "std_srvs/srv/Trigger"
  });

  service.callService({}, onResult, onError);
}

export function callCoverageCancel({ ros, serviceName, onResult, onError }) {
  const service = new ROSLIB.Service({
    ros,
    name: serviceName,
    serviceType: "std_srvs/srv/Trigger"
  });

  service.callService({}, onResult, onError);
}
