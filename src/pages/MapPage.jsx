/**
 * MapPage.jsx — Final
 * Konum: /tf zinciri (map→odom→base_link, CoveragePage ile aynı yöntem)
 * Path : /plan (cyan) + /local_plan (yeşil)
 * Nav2 : status panel + cancel
 */
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useROS } from "../context/ROSContext";
import * as ROSLIB from "roslib";

const BG="#04090f",SURFACE="#07111d",BORDER="#0f2236",BORDER2="#162d46";
const TEXT="#c8dde8",TEXT2="#4a7a96",TEXT3="#1e3a52",ACCENT="#0ea5e9";
const MONO="'JetBrains Mono','Fira Code',monospace";

const NAV2_STATUS={
  0:{label:"UNKNOWN",color:TEXT3,active:false},
  1:{label:"ACCEPTED",color:"#fbbf24",active:true},
  2:{label:"EXECUTING",color:"#0ea5e9",active:true},
  3:{label:"CANCELING",color:"#f59e0b",active:true},
  4:{label:"SUCCEEDED",color:"#10b981",active:false},
  5:{label:"CANCELED",color:"#94a3b8",active:false},
  6:{label:"ABORTED",color:"#ef4444",active:false},
};

function quatToYaw(q){if(!q)return 0;const{x=0,y=0,z=0,w=1}=q;return Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z));}
function yawToQuat(y){return{x:0,y:0,z:Math.sin(y/2),w:Math.cos(y/2)};}
function fmt(s){if(!isFinite(s)||s<=0)return"—";const m=Math.floor(s/60),sec=Math.floor(s%60);return m>0?`${m}m ${sec}s`:`${sec}s`;}

async function buildBitmap(msg){
  const{width:mw,height:mh}=msg.info,data=msg.data;
  const off=new OffscreenCanvas(mw,mh),ctx=off.getContext("2d"),img=ctx.createImageData(mw,mh);
  for(let r=0;r<mh;r++)for(let c=0;c<mw;c++){
    const src=(mh-1-r)*mw+c,dst=(r*mw+c)*4,v=data[src];
    const px=v<0?128:v===0?205:Math.round(255-(v/100)*205);
    img.data[dst]=px;img.data[dst+1]=px;img.data[dst+2]=px;img.data[dst+3]=255;
  }
  ctx.putImageData(img,0,0);return createImageBitmap(off);
}

function applyTF(msg,cache){
  if(!msg?.transforms)return;
  for(const t of msg.transforms){
    const p=(t.header?.frame_id||"").replace(/^\//,"");
    const c=(t.child_frame_id||"").replace(/^\//,"");
    const tr=t.transform?.translation,ro=t.transform?.rotation;
    if(!tr||!ro)continue;
    cache[c]={parent:p,tx:tr.x,ty:tr.y,qx:ro.x,qy:ro.y,qz:ro.z,qw:ro.w};
  }
}

function solveTF(cache){
  const tgt=cache["base_link"]?"base_link":cache["base_footprint"]?"base_footprint":null;
  if(!tgt)return null;
  const chain=[];let cur=tgt;const vis=new Set();
  while(cur&&cur!=="map"&&!vis.has(cur)){vis.add(cur);const tf=cache[cur];if(!tf)break;chain.push({...tf});cur=tf.parent;}
  if(cur!=="map")return null;
  chain.reverse();let wx=0,wy=0,wyaw=0;
  for(const tf of chain){const ty=quatToYaw({x:tf.qx,y:tf.qy,z:tf.qz,w:tf.qw});const cY=Math.cos(wyaw),sY=Math.sin(wyaw);wx+=cY*tf.tx-sY*tf.ty;wy+=sY*tf.tx+cY*tf.ty;wyaw+=ty;}
  return{x:wx,y:wy,yaw:wyaw};
}

function DragArrow({ctx,drag,color}){
  const{startPx:s,endPx:e}=drag;
  ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineWidth=2;
  ctx.beginPath();ctx.arc(s.x,s.y,6,0,Math.PI*2);ctx.fill();
  if(e){const a=Math.atan2(e.y-s.y,e.x-s.x);ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(e.x,e.y);ctx.stroke();
    ctx.beginPath();ctx.moveTo(e.x,e.y);ctx.lineTo(e.x-14*Math.cos(a-.4),e.y-14*Math.sin(a-.4));ctx.lineTo(e.x-14*Math.cos(a+.4),e.y-14*Math.sin(a+.4));ctx.closePath();ctx.fill();}
}

function ModeBtn({children,active,color,onClick}){
  return <button onClick={onClick} style={{padding:"0.3rem 0.65rem",background:active?`${color}18`:"transparent",border:`1px solid ${active?color:"#162d46"}`,borderRadius:4,color:active?color:"#4a7a96",cursor:"pointer",fontSize:"0.58rem",fontFamily:MONO,fontWeight:700,transition:"all 0.15s"}}>{children}</button>;
}
function ModeBar({color,bg,label,hint,extra}){
  return <div style={{flexShrink:0,background:bg,border:`1px solid ${color}44`,borderRadius:5,padding:"0.4rem 0.8rem",fontSize:"0.62rem",color,display:"flex",alignItems:"center",gap:"0.8rem",flexWrap:"wrap"}}><span style={{fontWeight:700}}>{label}</span><span style={{color:"#1e3a52"}}>{hint}</span>{extra&&<span style={{marginLeft:"auto"}}>{extra}</span>}</div>;
}
function Field({label,value,onChange}){
  return <div style={{flex:1,minWidth:200}}><div style={{fontSize:"0.5rem",color:TEXT3,letterSpacing:"0.1em",marginBottom:4}}>{label}</div><input value={value} onChange={e=>onChange(e.target.value)} style={{width:"100%",background:"#03070e",border:`1px solid ${BORDER}`,borderRadius:4,color:TEXT,padding:"0.35rem 0.5rem",fontSize:"0.68rem",fontFamily:MONO,outline:"none",boxSizing:"border-box"}}/></div>;
}


export default function MapPage(){
  const{ros,isConnected}=useROS();
  const[mapInfo,setMapInfo]=useState(null);
  const[mapReady,setMapReady]=useState(false);
  const[zoomLevel,setZoomLevel]=useState(1.0);
  const[showSettings,setShowSettings]=useState(false);
  const[showPaths,setShowPaths]=useState(true);
  const[navGoalMode,setNavGoalMode]=useState(false);
  const[initPoseMode,setInitPoseMode]=useState(false);
  const[lastGoal,setLastGoal]=useState(null);
  const[poseDisplay,setPoseDisplay]=useState(null);
  const[nav2Status,setNav2Status]=useState({code:0,label:"IDLE",color:TEXT2,active:false});
  const[nav2Feedback,setNav2Feedback]=useState(null);
  const[cancelling,setCancelling]=useState(false);
  const[mapTopicName,setMapTopicName]=useState("/map");
  const[pendingGoal,setPendingGoal]=useState(null); // onay bekleyen goal {x,y,yaw}

  const canvasRef=useRef(null),viewportRef=useRef(null);
  const mapBitmapRef=useRef(null),mapInfoRef=useRef(null);
  const poseRef=useRef(null),globalPathRef=useRef(null),localPathRef=useRef(null);
  const activeGoalRef=useRef(null),tfCacheRef=useRef({});
  const rafRef=useRef(null),zoomRef=useRef(1.0),showPathsRef=useRef(true);
  const navGoalModeRef=useRef(false),initPoseModeRef=useRef(false);
  const navDragRef=useRef(null),initPoseDragRef=useRef(null),cancellingRef=useRef(false);
  const goalPubRef=useRef(null),initPosePubRef=useRef(null),cancelSrvRef=useRef(null);
  // Pan (orta tuş sürükleme)
  const panRef=useRef({x:0,y:0});       // aktif pan offset (px)
  const panDragRef=useRef(null);         // {startMouse, startPan} — sürükleme başlangıcı

  useEffect(()=>{zoomRef.current=zoomLevel;},[zoomLevel]);
  useEffect(()=>{showPathsRef.current=showPaths;},[showPaths]);
  useEffect(()=>{navGoalModeRef.current=navGoalMode;},[navGoalMode]);
  useEffect(()=>{initPoseModeRef.current=initPoseMode;},[initPoseMode]);
  useEffect(()=>{cancellingRef.current=cancelling;},[cancelling]);

  const c2w=useCallback((px,py)=>{
    const info=mapInfoRef.current,vp=viewportRef.current;if(!info||!vp)return null;
    const vw=vp.clientWidth,vh=vp.clientHeight,scale=Math.min(vw/info.width,vh/info.height)*zoomRef.current;
    const pan=panRef.current;
    const ox=(vw-info.width*scale)/2+pan.x,oy=(vh-info.height*scale)/2+pan.y;
    return{x:((px-ox)/scale)*info.resolution+info.origin.position.x,y:(info.height-(py-oy)/scale)*info.resolution+info.origin.position.y};
  },[]);

  const w2c=useCallback((wx,wy)=>{
    const info=mapInfoRef.current,vp=viewportRef.current;if(!info||!vp)return null;
    const vw=vp.clientWidth,vh=vp.clientHeight,scale=Math.min(vw/info.width,vh/info.height)*zoomRef.current;
    const pan=panRef.current;
    const ox=(vw-info.width*scale)/2+pan.x,oy=(vh-info.height*scale)/2+pan.y;
    return{cx:ox+((wx-info.origin.position.x)/info.resolution)*scale,cy:oy+(info.height-(wy-info.origin.position.y)/info.resolution)*scale};
  },[]);

  const startRaf=useCallback(()=>{
    if(rafRef.current)cancelAnimationFrame(rafRef.current);
    const loop=()=>{
      const canvas=canvasRef.current,vp=viewportRef.current,bitmap=mapBitmapRef.current,info=mapInfoRef.current;
      if(canvas&&vp&&bitmap&&info){
        const dpr=window.devicePixelRatio||1,vw=vp.clientWidth,vh=vp.clientHeight;
        const nW=Math.round(vw*dpr),nH=Math.round(vh*dpr);
        if(canvas.width!==nW||canvas.height!==nH){canvas.width=nW;canvas.height=nH;}
        const ctx=canvas.getContext("2d");
        ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,vw,vh);ctx.imageSmoothingEnabled=false;
        const scale=Math.min(vw/info.width,vh/info.height)*zoomRef.current;
        const pan=panRef.current;
        const ox=(vw-info.width*scale)/2+pan.x,oy=(vh-info.height*scale)/2+pan.y;

        // 1. Harita
        ctx.drawImage(bitmap,ox,oy,info.width*scale,info.height*scale);

        // 2. Grid
        if(scale>20){
          const step=Math.round(1/info.resolution);
          ctx.strokeStyle="rgba(14,165,233,0.07)";ctx.lineWidth=0.5;
          for(let c=0;c<info.width;c+=step){const x=ox+c*scale;if(x>=0&&x<=vw){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,vh);ctx.stroke();}}
          for(let r=0;r<info.height;r+=step){const y=oy+r*scale;if(y>=0&&y<=vh){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(vw,y);ctx.stroke();}}
        }

        // 3. Global path
        if(showPathsRef.current){
          const gp=globalPathRef.current;
          if(gp&&gp.length>1){
            ctx.strokeStyle="rgba(14,165,233,0.55)";ctx.lineWidth=3;ctx.lineCap="round";ctx.lineJoin="round";
            ctx.beginPath();let st=false;
            for(const pt of gp){const cp=w2c(pt.x,pt.y);if(!cp)continue;if(!st){ctx.moveTo(cp.cx,cp.cy);st=true;}else ctx.lineTo(cp.cx,cp.cy);}
            ctx.stroke();
            if(scale>30){ctx.fillStyle="rgba(14,165,233,0.7)";const step=Math.max(1,Math.floor(gp.length/40));for(let i=0;i<gp.length;i+=step){const cp=w2c(gp[i].x,gp[i].y);if(!cp)continue;ctx.beginPath();ctx.arc(cp.cx,cp.cy,2,0,Math.PI*2);ctx.fill();}}
          }
          // 4. Local path
          const lp=localPathRef.current;
          if(lp&&lp.length>1){
            ctx.strokeStyle="#10b981";ctx.lineWidth=2.5;ctx.lineCap="round";ctx.shadowColor="#10b981";ctx.shadowBlur=8;
            ctx.beginPath();let st=false;
            for(const pt of lp){const cp=w2c(pt.x,pt.y);if(!cp)continue;if(!st){ctx.moveTo(cp.cx,cp.cy);st=true;}else ctx.lineTo(cp.cx,cp.cy);}
            ctx.stroke();ctx.shadowBlur=0;
          }
        }

        // 5. Aktif goal
        const ag=activeGoalRef.current;
        if(ag){const cp=w2c(ag.x,ag.y);if(cp){
          const{cx,cy}=cp,r=Math.max(8,scale*.15),pulse=.5+.5*Math.sin(Date.now()/300);
          ctx.strokeStyle=`rgba(245,158,11,${.3+.7*pulse})`;ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy,r*(1+.5*pulse),0,Math.PI*2);ctx.stroke();
          ctx.fillStyle="#f59e0b";ctx.beginPath();ctx.arc(cx,cy,r*.5,0,Math.PI*2);ctx.fill();
          const alen=r*1.8,ang=ag.yaw;
          ctx.strokeStyle="#f59e0b";ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+alen*Math.cos(ang),cy-alen*Math.sin(ang));ctx.stroke();
          const tX=cx+alen*Math.cos(ang),tY=cy-alen*Math.sin(ang);
          ctx.fillStyle="#f59e0b";ctx.beginPath();ctx.moveTo(tX,tY);ctx.lineTo(tX-10*Math.cos(ang-.4),tY+10*Math.sin(ang-.4));ctx.lineTo(tX-10*Math.cos(ang+.4),tY+10*Math.sin(ang+.4));ctx.closePath();ctx.fill();
          const pose=poseRef.current;if(pose){const rp=w2c(pose.x,pose.y);if(rp){ctx.strokeStyle="rgba(245,158,11,.2)";ctx.lineWidth=1;ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(rp.cx,rp.cy);ctx.lineTo(cx,cy);ctx.stroke();ctx.setLineDash([]);}}
        }}

        // 6. Robot
        const pose=poseRef.current;
        if(pose){const cp=w2c(pose.x,pose.y);if(cp){
          const{cx,cy}=cp,r=Math.max(6,scale*.18);
          ctx.shadowColor=ACCENT;ctx.shadowBlur=14;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle=ACCENT;ctx.fill();ctx.strokeStyle="#fff";ctx.lineWidth=1.5;ctx.stroke();
          ctx.shadowBlur=0;const alen=r*2.2;ctx.strokeStyle="#fff";ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+alen*Math.cos(pose.yaw),cy-alen*Math.sin(pose.yaw));ctx.stroke();
          const tX=cx+alen*Math.cos(pose.yaw),tY=cy-alen*Math.sin(pose.yaw);ctx.fillStyle="#fff";ctx.beginPath();ctx.moveTo(tX,tY);ctx.lineTo(tX-8*Math.cos(pose.yaw-.5),tY+8*Math.sin(pose.yaw-.5));ctx.lineTo(tX-8*Math.cos(pose.yaw+.5),tY+8*Math.sin(pose.yaw+.5));ctx.closePath();ctx.fill();
        }}

        // 7. Drag arrows
        const dr=navDragRef.current;if(dr?.startPx)DragArrow({ctx,drag:dr,color:"#f59e0b"});
        const ip=initPoseDragRef.current;if(ip?.startPx)DragArrow({ctx,drag:ip,color:"#a78bfa"});
      }
      rafRef.current=requestAnimationFrame(loop);
    };
    rafRef.current=requestAnimationFrame(loop);
  },[w2c]);

  useEffect(()=>{
    if(!ros||!isConnected){
      setMapReady(false);setMapInfo(null);
      mapBitmapRef.current=mapInfoRef.current=poseRef.current=activeGoalRef.current=globalPathRef.current=localPathRef.current=null;
      tfCacheRef.current={};setPoseDisplay(null);
      setNav2Status({code:0,label:"IDLE",color:TEXT2,active:false});setNav2Feedback(null);
      return;
    }

    goalPubRef.current=new ROSLIB.Topic({ros,name:"/goal_pose",messageType:"geometry_msgs/PoseStamped"});
    initPosePubRef.current=new ROSLIB.Topic({ros,name:"/initialpose",messageType:"geometry_msgs/PoseWithCovarianceStamped"});
    cancelSrvRef.current=new ROSLIB.Service({ros,name:"/navigate_to_pose/_action/cancel_goal",serviceType:"action_msgs/srv/CancelGoal"});

    // Map
    const mapSub=new ROSLIB.Topic({ros,name:mapTopicName,messageType:"nav_msgs/OccupancyGrid",queue_length:1,throttle_rate:5000});
    mapSub.subscribe(async(msg)=>{
      const{width,height,resolution,origin}=msg.info;
      const info={width,height,resolution,origin};
      const bitmap=await buildBitmap(msg);
      mapBitmapRef.current=bitmap;mapInfoRef.current=info;setMapInfo(info);setMapReady(true);
    });

    // TF (map→odom→base_link — Cartographer/EKF ile çalışır)
    const cache=tfCacheRef.current;
    const handleTF=(msg)=>{
      applyTF(msg,cache);
      const pose=solveTF(cache);
      if(!pose)return;
      poseRef.current=pose;
      setPoseDisplay(d=>(!d||!d._ts||Date.now()-d._ts>200)?{...pose,source:"tf",_ts:Date.now()}:d);
    };
    const tfSub=new ROSLIB.Topic({ros,name:"/tf",messageType:"tf2_msgs/msg/TFMessage",throttle_rate:100,queue_length:5});
    tfSub.subscribe(handleTF);
    const tfsSub=new ROSLIB.Topic({ros,name:"/tf_static",messageType:"tf2_msgs/msg/TFMessage",throttle_rate:1000,queue_length:5});
    tfsSub.subscribe(handleTF);

    // 3s sonra TF gelmemişse /amcl_pose fallback
    let amclSub=null;
    const amclTimer=setTimeout(()=>{
      if(poseRef.current)return;
      amclSub=new ROSLIB.Topic({ros,name:"/amcl_pose",messageType:"geometry_msgs/PoseWithCovarianceStamped",throttle_rate:200,queue_length:1});
      amclSub.subscribe((msg)=>{
        if(!msg?.pose?.pose)return;
        const{position:pos,orientation:ori}=msg.pose.pose;
        const pose={x:pos.x,y:pos.y,yaw:quatToYaw(ori)};
        poseRef.current=pose;
        setPoseDisplay(d=>(!d||!d._ts||Date.now()-d._ts>200)?{...pose,source:"amcl",_ts:Date.now()}:d);
      });
    },3000);

    // Global path
    const planSub=new ROSLIB.Topic({ros,name:"/plan",messageType:"nav_msgs/Path",queue_length:1,throttle_rate:500});
    planSub.subscribe((msg)=>{
      if(!msg?.poses?.length){globalPathRef.current=null;return;}
      globalPathRef.current=msg.poses.map(p=>({x:p.pose.position.x,y:p.pose.position.y}));
    });

    // Local path
    const localSub=new ROSLIB.Topic({ros,name:"/local_plan",messageType:"nav_msgs/Path",queue_length:1,throttle_rate:150});
    localSub.subscribe((msg)=>{
      if(!msg?.poses?.length){localPathRef.current=null;return;}
      localPathRef.current=msg.poses.map(p=>({x:p.pose.position.x,y:p.pose.position.y}));
    });

    // Nav2 status
    const statusSub=new ROSLIB.Topic({ros,name:"/navigate_to_pose/_action/status",messageType:"action_msgs/msg/GoalStatusArray",queue_length:1,throttle_rate:200});
    statusSub.subscribe((msg)=>{
      const list=msg?.status_list;if(!Array.isArray(list)||!list.length)return;
      let latest=list[0],latestNs=(latest.goal_info?.stamp?.sec??0)*1e9+(latest.goal_info?.stamp?.nanosec??0);
      for(const s of list){const ns=(s.goal_info?.stamp?.sec??0)*1e9+(s.goal_info?.stamp?.nanosec??0);if(ns>latestNs){latest=s;latestNs=ns;}}
      const info=NAV2_STATUS[latest.status]||NAV2_STATUS[0];
      setNav2Status({code:latest.status,...info});
      if(!info.active){
        activeGoalRef.current=null;
        setTimeout(()=>{globalPathRef.current=null;localPathRef.current=null;},1500);
        setTimeout(()=>{setNav2Status(p=>p.code===latest.status?{code:0,label:"IDLE",color:TEXT2,active:false}:p);setNav2Feedback(null);setCancelling(false);},latest.status===4?3000:5000);
      }
    });

    // Nav2 feedback
    const fbSub=new ROSLIB.Topic({ros,name:"/navigate_to_pose/_action/feedback",messageType:"nav2_msgs/action/NavigateToPose_FeedbackMessage",queue_length:1,throttle_rate:500});
    fbSub.subscribe((msg)=>{
      const fb=msg?.feedback;if(!fb)return;
      setNav2Feedback({distance:fb.distance_remaining??0,eta:(fb.estimated_time_remaining?.sec??0)+(fb.estimated_time_remaining?.nanosec??0)/1e9,navTime:(fb.navigation_time?.sec??0)+(fb.navigation_time?.nanosec??0)/1e9,recoveries:fb.number_of_recoveries??0});
    });

    startRaf();

    return()=>{
      clearTimeout(amclTimer);
      [mapSub,tfSub,tfsSub,planSub,localSub,statusSub,fbSub].forEach(s=>{try{s.unsubscribe();}catch{}});
      try{if(amclSub)amclSub.unsubscribe();}catch{}
      if(rafRef.current)cancelAnimationFrame(rafRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[ros,isConnected,mapTopicName]);

  const cancelGoal=useCallback(()=>{
    if(!cancelSrvRef.current)return;
    setCancelling(true);activeGoalRef.current=globalPathRef.current=localPathRef.current=null;
    cancelSrvRef.current.callService({goal_info:{goal_id:{uuid:Array(16).fill(0)},stamp:{sec:0,nanosec:0}}},(r)=>console.log("[Cancel]",r),(e)=>{console.error(e);setCancelling(false);});
    setTimeout(()=>{if(!cancellingRef.current)return;const pose=poseRef.current;if(pose&&goalPubRef.current)goalPubRef.current.publish({header:{frame_id:"map",stamp:{sec:Math.floor(Date.now()/1000),nanosec:0}},pose:{position:{x:pose.x,y:pose.y,z:0},orientation:yawToQuat(pose.yaw)}});},1500);
    setTimeout(()=>{if(!cancellingRef.current)return;setCancelling(false);setNav2Status({code:0,label:"IDLE",color:TEXT2,active:false});setNav2Feedback(null);},6000);
  },[]);

  const publishGoal=useCallback((x,y,yaw)=>{
    if(!goalPubRef.current)return;
    goalPubRef.current.publish({header:{frame_id:"map",stamp:{sec:Math.floor(Date.now()/1000),nanosec:0}},pose:{position:{x,y,z:0},orientation:yawToQuat(yaw)}});
    activeGoalRef.current={x,y,yaw};setLastGoal({x,y,yaw});setCancelling(false);
  },[]);

  const confirmGoal=useCallback(()=>{
    if(!pendingGoal)return;
    publishGoal(pendingGoal.x,pendingGoal.y,pendingGoal.yaw);
    setPendingGoal(null);setNavGoalMode(false);
  },[pendingGoal,publishGoal]);

  const onMouseDown=useCallback((e)=>{
    if(e.button===1){e.preventDefault();panDragRef.current={startMouse:{x:e.clientX,y:e.clientY},startPan:{...panRef.current}};return;}
    const rect=e.currentTarget.getBoundingClientRect(),px={x:e.clientX-rect.left,y:e.clientY-rect.top};
    if(navGoalModeRef.current&&mapInfoRef.current)navDragRef.current={startPx:px,endPx:null};
    if(initPoseModeRef.current&&mapInfoRef.current)initPoseDragRef.current={startPx:px,endPx:null};
  },[]);

  const onMouseMove=useCallback((e)=>{
    if(panDragRef.current){const{startMouse,startPan}=panDragRef.current;panRef.current={x:startPan.x+(e.clientX-startMouse.x),y:startPan.y+(e.clientY-startMouse.y)};return;}
    const rect=e.currentTarget.getBoundingClientRect(),px={x:e.clientX-rect.left,y:e.clientY-rect.top};
    if(navDragRef.current)navDragRef.current={...navDragRef.current,endPx:px};
    if(initPoseDragRef.current)initPoseDragRef.current={...initPoseDragRef.current,endPx:px};
  },[]);

  const onMouseUp=useCallback((e)=>{
    if(e.button===1){panDragRef.current=null;return;}
    const rect=e.currentTarget.getBoundingClientRect(),ep={x:e.clientX-rect.left,y:e.clientY-rect.top};
    if(navDragRef.current){
      const{startPx:s}=navDragRef.current,wp=c2w(s.x,s.y);
      if(wp){const dx=ep.x-s.x,dy=ep.y-s.y,dist=Math.sqrt(dx*dx+dy*dy);const yaw=dist>10?Math.atan2(-dy,dx):(poseRef.current?.yaw??0);setPendingGoal({x:wp.x,y:wp.y,yaw});}
      navDragRef.current=null;
    }
    if(initPoseDragRef.current){
      const{startPx:s}=initPoseDragRef.current,wp=c2w(s.x,s.y);
      if(wp&&initPosePubRef.current){const dx=ep.x-s.x,dy=ep.y-s.y,dist=Math.sqrt(dx*dx+dy*dy),yaw=dist>10?Math.atan2(-dy,dx):0;
        initPosePubRef.current.publish({header:{frame_id:"map",stamp:{sec:Math.floor(Date.now()/1000),nanosec:0}},pose:{pose:{position:{x:wp.x,y:wp.y,z:0},orientation:yawToQuat(yaw)},covariance:[.25,0,0,0,0,0,0,.25,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,.07]}});}
      initPoseDragRef.current=null;setInitPoseMode(false);
    }
  },[c2w,publishGoal]);

  const onMouseLeave=useCallback(()=>{navDragRef.current=null;initPoseDragRef.current=null;});
  const onContextMenu=useCallback((e)=>e.preventDefault(),[]);
  const isPanning=!!panDragRef.current;
  const cursor=isPanning?"grabbing":navGoalMode?"crosshair":initPoseMode?"cell":"default";

  return (
    <div className="page-root" style={{height:"calc(100vh - 56px)",display:"flex",flexDirection:"column",background:BG,color:TEXT,fontFamily:MONO,padding:"0.5rem",gap:"0.4rem",boxSizing:"border-box",overflow:"hidden"}}>

      {/* ÜST BAR */}
      <div style={{flexShrink:0,display:"flex",alignItems:"center",gap:"0.5rem",flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:"0.5rem"}}>
          <div style={{width:32,height:32,borderRadius:8,background:"linear-gradient(135deg,#0ea5e9,#6366f1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1rem"}}>🗺️</div>
          <div><div style={{fontSize:"0.85rem",fontWeight:800,letterSpacing:"0.12em"}}>MAP VIEW</div><div style={{fontSize:"0.5rem",color:TEXT3,letterSpacing:"0.08em"}}>NAV2 INTERACTIVE</div></div>
        </div>
        <div style={{flex:1}}/>
        <ModeBtn active={navGoalMode} color="#f59e0b" onClick={()=>{setNavGoalMode(m=>!m);setInitPoseMode(false);}}>🎯 NAV GOAL</ModeBtn>
        <ModeBtn active={initPoseMode} color="#a78bfa" onClick={()=>{setInitPoseMode(m=>!m);setNavGoalMode(false);}}>📍 SET POSE</ModeBtn>
        <ModeBtn active={showPaths} color="#10b981" onClick={()=>setShowPaths(s=>!s)}>〰 PATH</ModeBtn>
        <ModeBtn active={showSettings} color={TEXT2} onClick={()=>setShowSettings(s=>!s)}>⚙ SETTINGS</ModeBtn>
      </div>

      {/* SETTINGS */}
      {showSettings&&<div style={{flexShrink:0,background:SURFACE,border:`1px solid ${BORDER2}`,borderRadius:6,padding:"0.6rem 0.8rem",display:"flex",gap:"1rem",flexWrap:"wrap"}}>
        <Field label="MAP TOPIC" value={mapTopicName} onChange={setMapTopicName}/>
        <div style={{flex:1,minWidth:200}}>
          <div style={{fontSize:"0.5rem",color:TEXT3,letterSpacing:"0.1em",marginBottom:4}}>ZOOM {zoomLevel.toFixed(1)}×</div>
          <input type="range" min={0.3} max={4} step={0.1} value={zoomLevel} onChange={e=>setZoomLevel(parseFloat(e.target.value))} style={{width:"100%"}}/>
          <button onClick={()=>{panRef.current={x:0,y:0};}} style={{marginTop:6,padding:"0.28rem 0.55rem",background:"transparent",border:"1px solid #162d46",borderRadius:4,color:"#4a7a96",fontFamily:MONO,fontSize:"0.55rem",cursor:"pointer"}}>⌖ MERKEZE AL</button>
        </div>
      </div>}

      {/* MOD BARLAR */}
      {navGoalMode&&<ModeBar color="#f59e0b" bg="#1a1000" label="🎯 NAV GOAL AKTİF" hint="Haritaya tıkla → sürükle (yön) → bırak" extra={lastGoal&&`x=${lastGoal.x.toFixed(2)} y=${lastGoal.y.toFixed(2)} θ=${(lastGoal.yaw*180/Math.PI).toFixed(0)}°`}/>}
      {initPoseMode&&<ModeBar color="#a78bfa" bg="#0d0a1a" label="📍 INITIAL POSE (AMCL)" hint="Robotun gerçek konumuna tıkla → sürükle (yön) → bırak"/>}

      {/* CANVAS */}
      <div style={{flex:1,background:SURFACE,borderRadius:6,padding:"0.6rem",border:`1px solid ${BORDER2}`,display:"flex",flexDirection:"column",minHeight:0}}>
        {/* Header */}
        <div style={{flexShrink:0,display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.35rem",gap:"0.5rem",flexWrap:"wrap"}}>
          {mapInfo&&<div style={{fontSize:"0.55rem",color:TEXT2}}>{mapInfo.width}×{mapInfo.height} · {mapInfo.resolution.toFixed(3)} m/px</div>}
          {poseDisplay?(
            <div style={{display:"flex",alignItems:"center",gap:"0.6rem"}}>
              <div style={{fontSize:"0.58rem",display:"flex",gap:"0.6rem",color:ACCENT}}>
                <span>x <b>{poseDisplay.x.toFixed(3)}</b></span>
                <span>y <b>{poseDisplay.y.toFixed(3)}</b></span>
                <span>θ <b>{(poseDisplay.yaw*180/Math.PI).toFixed(1)}°</b></span>
              </div>
              <div style={{fontSize:"0.48rem",color:"#10b981",letterSpacing:"0.08em"}}>● {(poseDisplay.source||"").toUpperCase()}</div>
            </div>
          ):<div style={{fontSize:"0.52rem",color:TEXT3}}>○ KONUM YOK — TF bekleniyor</div>}
        </div>

        {/* Viewport */}
        <div ref={viewportRef} className="vp-fill" style={{flex:1,overflow:"hidden",borderRadius:5,border:`1px solid ${BORDER2}`,background:"#020609",position:"relative",minHeight:0,cursor}}>
          {mapReady
            ?<canvas ref={canvasRef} style={{width:"100%",height:"100%",display:"block"}} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseLeave} onContextMenu={onContextMenu}/>
            :<div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"0.5rem"}}>
              <div style={{fontSize:"2rem",opacity:.12}}>🗺️</div>
              <div style={{fontSize:"0.7rem",color:TEXT3}}>{isConnected?"Harita bekleniyor...":"Bağlantı bekleniyor"}</div>
            </div>
          }

          {/* NAV2 STATUS PANEL */}
          {mapReady&&<div style={{position:"absolute",bottom:12,right:12,minWidth:230,background:"rgba(7,17,29,0.95)",border:`1px solid ${nav2Status.active?nav2Status.color:BORDER2}`,borderRadius:6,padding:"0.6rem 0.75rem",backdropFilter:"blur(8px)",boxShadow:nav2Status.active?`0 4px 24px ${nav2Status.color}40,0 0 0 1px ${nav2Status.color}22`:"0 4px 16px rgba(0,0,0,0.6)",transition:"all .25s ease"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
              <div style={{fontSize:"0.48rem",color:TEXT3,letterSpacing:"0.14em",fontWeight:700}}>NAV2 STATUS</div>
              <div style={{display:"flex",alignItems:"center",gap:5,fontSize:"0.65rem",fontWeight:800,color:nav2Status.color,letterSpacing:"0.08em"}}>
                <span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:nav2Status.color,boxShadow:nav2Status.active?`0 0 10px ${nav2Status.color}`:"none",animation:nav2Status.active?"nav2p 1.2s infinite":"none"}}/>
                {nav2Status.label}
              </div>
            </div>
            {nav2Status.active&&nav2Feedback&&<div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:"3px 12px",fontSize:"0.6rem",marginBottom:4}}>
              <span style={{color:TEXT3}}>Kalan</span><span style={{color:TEXT,fontWeight:700}}>{nav2Feedback.distance.toFixed(2)} m</span>
              <span style={{color:TEXT3}}>ETA</span><span style={{color:TEXT,fontWeight:700}}>{fmt(nav2Feedback.eta)}</span>
              <span style={{color:TEXT3}}>Süre</span><span style={{color:TEXT2}}>{fmt(nav2Feedback.navTime)}</span>
              {nav2Feedback.recoveries>0&&<><span style={{color:"#f59e0b"}}>Recovery</span><span style={{color:"#fbbf24",fontWeight:700}}>{nav2Feedback.recoveries}×</span></>}
            </div>}
            {nav2Status.active&&<button onClick={cancelGoal} disabled={cancelling} style={{marginTop:6,width:"100%",padding:"0.5rem",borderRadius:5,background:cancelling?"#7f1d1d":"#dc2626",border:"1px solid #ef4444",color:"#fff",fontFamily:MONO,fontSize:"0.68rem",fontWeight:800,letterSpacing:"0.12em",cursor:cancelling?"wait":"pointer",boxShadow:"0 2px 14px rgba(220,38,38,.45)",transition:"all .15s"}} onMouseEnter={e=>{if(!cancelling)e.currentTarget.style.background="#ef4444";}} onMouseLeave={e=>{if(!cancelling)e.currentTarget.style.background="#dc2626";}}>
              {cancelling?"⏳ İPTAL EDİLİYOR...":"✕  GOAL İPTAL ET"}
            </button>}
            {!nav2Status.active&&nav2Status.code!==0&&<div style={{fontSize:"0.6rem",color:nav2Status.color,fontWeight:600}}>
              {nav2Status.code===4&&"✓ Hedefe varıldı"}{nav2Status.code===5&&"⊘ İptal edildi"}{nav2Status.code===6&&"✗ Hedef abort edildi"}
            </div>}
          </div>}
        </div>
      </div>

      {/* LEGEND */}
      <div style={{flexShrink:0,background:SURFACE,borderRadius:5,padding:"0.4rem 0.8rem",border:`1px solid ${BORDER2}`,display:"flex",gap:"1rem",justifyContent:"center",flexWrap:"wrap"}}>
        {[{color:"#cdcdcd",label:"FREE"},{color:"#333",label:"OBSTACLE"},{color:"#808080",label:"UNKNOWN"},{color:ACCENT,round:true,label:"ROBOT"},{color:"#f59e0b",round:true,label:"NAV GOAL"},{color:"rgba(14,165,233,0.7)",line:true,label:"GLOBAL PATH"},{color:"#10b981",line:true,label:"LOCAL PATH"}]
          .map(({color,label,round,line})=>(
            <div key={label} style={{display:"flex",alignItems:"center",gap:"0.35rem",fontSize:"0.55rem",color:TEXT2}}>
              {line?<div style={{width:16,height:3,background:color,borderRadius:2}}/>:<div style={{width:9,height:9,background:color,border:`1px solid ${BORDER2}`,borderRadius:round?"50%":2}}/>}
              {label}
            </div>
          ))}
      </div>

      <style>{`@keyframes nav2p{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(1.5)}}`}</style>

      {/* ─── CONFIRM MODAL ─────────────────────────────────────────────── */}
      {pendingGoal&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(4px)"}}>
        <div style={{background:"#07111d",border:"1px solid #f59e0b66",borderRadius:10,padding:"1.4rem 1.8rem",minWidth:300,maxWidth:400,boxShadow:"0 8px 40px rgba(0,0,0,0.7)"}}>
          <div style={{fontSize:"0.55rem",color:"#1e3a52",letterSpacing:"0.14em",marginBottom:8}}>NAV GOAL ONAYI</div>
          <div style={{fontSize:"0.85rem",fontWeight:800,color:"#f59e0b",marginBottom:16}}>🎯 Hedefe git?</div>
          <div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:"4px 12px",fontSize:"0.65rem",marginBottom:20,background:"#04090f",borderRadius:6,padding:"0.6rem 0.8rem"}}>
            <span style={{color:"#4a7a96"}}>X</span><span style={{color:"#c8dde8",fontWeight:700}}>{pendingGoal.x.toFixed(3)} m</span>
            <span style={{color:"#4a7a96"}}>Y</span><span style={{color:"#c8dde8",fontWeight:700}}>{pendingGoal.y.toFixed(3)} m</span>
            <span style={{color:"#4a7a96"}}>Yön</span><span style={{color:"#c8dde8",fontWeight:700}}>{(pendingGoal.yaw*180/Math.PI).toFixed(1)}°</span>
          </div>
          <div style={{display:"flex",gap:"0.6rem"}}>
            <button onClick={()=>setPendingGoal(null)} style={{flex:1,padding:"0.6rem",borderRadius:6,background:"transparent",border:"1px solid #162d46",color:"#4a7a96",fontFamily:MONO,fontSize:"0.65rem",fontWeight:700,cursor:"pointer",letterSpacing:"0.1em"}}>
              ✕ İPTAL
            </button>
            <button onClick={confirmGoal} style={{flex:2,padding:"0.6rem",borderRadius:6,background:"#f59e0b",border:"1px solid #fbbf24",color:"#000",fontFamily:MONO,fontSize:"0.65rem",fontWeight:800,cursor:"pointer",letterSpacing:"0.1em",boxShadow:"0 2px 12px rgba(245,158,11,0.4)"}}>
              ✓ ONAYLA — GİT
            </button>
          </div>
        </div>
      </div>}
    </div>
  );
}
