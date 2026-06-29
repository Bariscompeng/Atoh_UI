import * as ROSLIB from "roslib";

export function publishNoGoPayload({ ros, topicName, payload }) {
  const topic = new ROSLIB.Topic({
    ros,
    name: topicName,
    messageType: "std_msgs/msg/String",
    queue_size: 1,
    latch: true
  });

  topic.publish({ data: JSON.stringify(payload) });
  setTimeout(() => {
    try {
      topic.unadvertise();
    } catch (e) {
      console.warn("[GPSMissionPlanner] no-go topic unadvertise error:", e);
    }
  }, 500);
}
