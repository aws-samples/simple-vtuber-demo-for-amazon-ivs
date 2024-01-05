//Import Helper Functions from Kalidokit
const remap = Kalidokit.Utils.remap;
const clamp = Kalidokit.Utils.clamp;
const lerp = Kalidokit.Vector.lerp;

// Amazon addition 11-08-2023

const { Stage, LocalStageStream, SubscribeType, StageEvents, ConnectionState, StreamType } = IVSBroadcastClient;

const modal = document.querySelector(".modal");
const overlay = document.querySelector(".overlay");
const openModalBtn = document.querySelector(".button-open");
const submitBtn = document.getElementById("submit-btn");
const joinBtn = document.getElementById("join-stage-btn");
const tokenInput = document.getElementById("participant-token");
const canvasElement = document.getElementById("canvas");

// Stage management
let stage;
let joining = false;
let connected = false;
let localCamera;
let localMic;
let cameraStageStream;
let micStageStream;

// End Amazon addition

/* THREEJS WORLD SETUP */
let currentVrm;

// renderer
const renderer = new THREE.WebGLRenderer({ alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// camera
const orbitCamera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 1000);
orbitCamera.position.set(0.0, 1.4, 0.7);

// controls
const orbitControls = new THREE.OrbitControls(orbitCamera, renderer.domElement);
orbitControls.screenSpacePanning = true;
orbitControls.target.set(0.0, 1.4, 0.0);
orbitControls.update();

// scene
const scene = new THREE.Scene();

// light
const light = new THREE.DirectionalLight(0xffffff);
light.position.set(1.0, 1.0, 1.0).normalize();
scene.add(light);

// Main Render Loop
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  if (currentVrm) {
    // Update model to render physics
    currentVrm.update(clock.getDelta());
  }
  renderer.render(scene, orbitCamera);
}
animate();

/* VRM CHARACTER SETUP */

// Import Character VRM
const loader = new THREE.GLTFLoader();
loader.crossOrigin = "anonymous";
// Import model from URL, add your own model here
loader.load(
  // Amazon addition 11-08-2023
  "https://d1l5n2avb89axj.cloudfront.net/avatar-first.vrm",
  // End Amazon addition

  (gltf) => {
    THREE.VRMUtils.removeUnnecessaryJoints(gltf.scene);

    THREE.VRM.from(gltf).then((vrm) => {
      scene.add(vrm.scene);
      currentVrm = vrm;
      currentVrm.scene.rotation.y = Math.PI; // Rotate model 180deg to face camera
    });
  },

  (progress) => console.log("Loading model...", 100.0 * (progress.loaded / progress.total), "%"),

  (error) => console.error(error)
);

// Animate Rotation Helper function
const rigRotation = (name, rotation = { x: 0, y: 0, z: 0 }, dampener = 1, lerpAmount = 0.3) => {
  if (!currentVrm) {
    return;
  }
  const Part = currentVrm.humanoid.getBoneNode(THREE.VRMSchema.HumanoidBoneName[name]);
  if (!Part) {
    return;
  }

  let euler = new THREE.Euler(rotation.x * dampener, rotation.y * dampener, rotation.z * dampener);
  let quaternion = new THREE.Quaternion().setFromEuler(euler);
  Part.quaternion.slerp(quaternion, lerpAmount); // interpolate
};

// Animate Position Helper Function
const rigPosition = (name, position = { x: 0, y: 0, z: 0 }, dampener = 1, lerpAmount = 0.3) => {
  if (!currentVrm) {
    return;
  }
  const Part = currentVrm.humanoid.getBoneNode(THREE.VRMSchema.HumanoidBoneName[name]);
  if (!Part) {
    return;
  }
  let vector = new THREE.Vector3(position.x * dampener, position.y * dampener, position.z * dampener);
  Part.position.lerp(vector, lerpAmount); // interpolate
};

let oldLookTarget = new THREE.Euler();
const rigFace = (riggedFace) => {
  if (!currentVrm) {
    return;
  }
  rigRotation("Neck", riggedFace.head, 0.7);

  // Blendshapes and Preset Name Schema
  const Blendshape = currentVrm.blendShapeProxy;
  const PresetName = THREE.VRMSchema.BlendShapePresetName;

  // Simple example without winking. Interpolate based on old blendshape, then stabilize blink with `Kalidokit` helper function.
  // for VRM, 1 is closed, 0 is open.
  riggedFace.eye.l = lerp(clamp(1 - riggedFace.eye.l, 0, 1), Blendshape.getValue(PresetName.Blink), 0.5);
  riggedFace.eye.r = lerp(clamp(1 - riggedFace.eye.r, 0, 1), Blendshape.getValue(PresetName.Blink), 0.5);
  riggedFace.eye = Kalidokit.Face.stabilizeBlink(riggedFace.eye, riggedFace.head.y);
  Blendshape.setValue(PresetName.Blink, riggedFace.eye.l);

  // Interpolate and set mouth blendshapes
  Blendshape.setValue(PresetName.I, lerp(riggedFace.mouth.shape.I, Blendshape.getValue(PresetName.I), 0.5));
  Blendshape.setValue(PresetName.A, lerp(riggedFace.mouth.shape.A, Blendshape.getValue(PresetName.A), 0.5));
  Blendshape.setValue(PresetName.E, lerp(riggedFace.mouth.shape.E, Blendshape.getValue(PresetName.E), 0.5));
  Blendshape.setValue(PresetName.O, lerp(riggedFace.mouth.shape.O, Blendshape.getValue(PresetName.O), 0.5));
  Blendshape.setValue(PresetName.U, lerp(riggedFace.mouth.shape.U, Blendshape.getValue(PresetName.U), 0.5));

  //PUPILS
  //interpolate pupil and keep a copy of the value
  let lookTarget = new THREE.Euler(lerp(oldLookTarget.x, riggedFace.pupil.y, 0.4), lerp(oldLookTarget.y, riggedFace.pupil.x, 0.4), 0, "XYZ");
  oldLookTarget.copy(lookTarget);
  currentVrm.lookAt.applyer.lookAt(lookTarget);
};

/* VRM Character Animator */
const animateVRM = (vrm, results) => {
  if (!vrm) {
    return;
  }
  // Take the results from `Holistic` and animate character based on its Face, Pose, and Hand Keypoints.
  let riggedPose, riggedLeftHand, riggedRightHand, riggedFace;

  const faceLandmarks = results.faceLandmarks;
  // Pose 3D Landmarks are with respect to Hip distance in meters
  const pose3DLandmarks = results.ea;
  // Pose 2D landmarks are with respect to videoWidth and videoHeight
  const pose2DLandmarks = results.poseLandmarks;
  // Be careful, hand landmarks may be reversed
  const leftHandLandmarks = results.rightHandLandmarks;
  const rightHandLandmarks = results.leftHandLandmarks;

  // Animate Face
  if (faceLandmarks) {
    riggedFace = Kalidokit.Face.solve(faceLandmarks, {
      runtime: "mediapipe",
      video: videoElement,
    });
    rigFace(riggedFace);
  }

  // Animate Pose
  if (pose2DLandmarks && pose3DLandmarks) {
    riggedPose = Kalidokit.Pose.solve(pose3DLandmarks, pose2DLandmarks, {
      runtime: "mediapipe",
      video: videoElement,
    });
    rigRotation("Hips", riggedPose.Hips.rotation, 0.7);
    rigPosition(
      "Hips",
      {
        x: -riggedPose.Hips.position.x, // Reverse direction
        y: riggedPose.Hips.position.y + 1, // Add a bit of height
        z: -riggedPose.Hips.position.z, // Reverse direction
      },
      1,
      0.07
    );

    rigRotation("Chest", riggedPose.Spine, 0.25, 0.3);
    rigRotation("Spine", riggedPose.Spine, 0.45, 0.3);

    rigRotation("RightUpperArm", riggedPose.RightUpperArm, 1, 0.3);
    rigRotation("RightLowerArm", riggedPose.RightLowerArm, 1, 0.3);
    rigRotation("LeftUpperArm", riggedPose.LeftUpperArm, 1, 0.3);
    rigRotation("LeftLowerArm", riggedPose.LeftLowerArm, 1, 0.3);

    rigRotation("LeftUpperLeg", riggedPose.LeftUpperLeg, 1, 0.3);
    rigRotation("LeftLowerLeg", riggedPose.LeftLowerLeg, 1, 0.3);
    rigRotation("RightUpperLeg", riggedPose.RightUpperLeg, 1, 0.3);
    rigRotation("RightLowerLeg", riggedPose.RightLowerLeg, 1, 0.3);
  }

  // Animate Hands
  if (leftHandLandmarks) {
    riggedLeftHand = Kalidokit.Hand.solve(leftHandLandmarks, "Left");
    rigRotation("LeftHand", {
      // Combine pose rotation Z and hand rotation X Y
      z: riggedPose.LeftHand.z,
      y: riggedLeftHand.LeftWrist.y,
      x: riggedLeftHand.LeftWrist.x,
    });
    rigRotation("LeftRingProximal", riggedLeftHand.LeftRingProximal);
    rigRotation("LeftRingIntermediate", riggedLeftHand.LeftRingIntermediate);
    rigRotation("LeftRingDistal", riggedLeftHand.LeftRingDistal);
    rigRotation("LeftIndexProximal", riggedLeftHand.LeftIndexProximal);
    rigRotation("LeftIndexIntermediate", riggedLeftHand.LeftIndexIntermediate);
    rigRotation("LeftIndexDistal", riggedLeftHand.LeftIndexDistal);
    rigRotation("LeftMiddleProximal", riggedLeftHand.LeftMiddleProximal);
    rigRotation("LeftMiddleIntermediate", riggedLeftHand.LeftMiddleIntermediate);
    rigRotation("LeftMiddleDistal", riggedLeftHand.LeftMiddleDistal);
    rigRotation("LeftThumbProximal", riggedLeftHand.LeftThumbProximal);
    rigRotation("LeftThumbIntermediate", riggedLeftHand.LeftThumbIntermediate);
    rigRotation("LeftThumbDistal", riggedLeftHand.LeftThumbDistal);
    rigRotation("LeftLittleProximal", riggedLeftHand.LeftLittleProximal);
    rigRotation("LeftLittleIntermediate", riggedLeftHand.LeftLittleIntermediate);
    rigRotation("LeftLittleDistal", riggedLeftHand.LeftLittleDistal);
  }
  if (rightHandLandmarks) {
    riggedRightHand = Kalidokit.Hand.solve(rightHandLandmarks, "Right");
    rigRotation("RightHand", {
      // Combine Z axis from pose hand and X/Y axis from hand wrist rotation
      z: riggedPose.RightHand.z,
      y: riggedRightHand.RightWrist.y,
      x: riggedRightHand.RightWrist.x,
    });
    rigRotation("RightRingProximal", riggedRightHand.RightRingProximal);
    rigRotation("RightRingIntermediate", riggedRightHand.RightRingIntermediate);
    rigRotation("RightRingDistal", riggedRightHand.RightRingDistal);
    rigRotation("RightIndexProximal", riggedRightHand.RightIndexProximal);
    rigRotation("RightIndexIntermediate", riggedRightHand.RightIndexIntermediate);
    rigRotation("RightIndexDistal", riggedRightHand.RightIndexDistal);
    rigRotation("RightMiddleProximal", riggedRightHand.RightMiddleProximal);
    rigRotation("RightMiddleIntermediate", riggedRightHand.RightMiddleIntermediate);
    rigRotation("RightMiddleDistal", riggedRightHand.RightMiddleDistal);
    rigRotation("RightThumbProximal", riggedRightHand.RightThumbProximal);
    rigRotation("RightThumbIntermediate", riggedRightHand.RightThumbIntermediate);
    rigRotation("RightThumbDistal", riggedRightHand.RightThumbDistal);
    rigRotation("RightLittleProximal", riggedRightHand.RightLittleProximal);
    rigRotation("RightLittleIntermediate", riggedRightHand.RightLittleIntermediate);
    rigRotation("RightLittleDistal", riggedRightHand.RightLittleDistal);
  }
};

/* SETUP MEDIAPIPE HOLISTIC INSTANCE */
let videoElement = document.querySelector(".input_video");

const onResults = (results) => {
  // Animate model
  animateVRM(currentVrm, results);
};

const holistic = new Holistic({
  locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1635989137/${file}`;
  },
});

holistic.setOptions({
  modelComplexity: 1,
  smoothLandmarks: true,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7,
  refineFaceLandmarks: true,
});
// Pass holistic a callback function
holistic.onResults(onResults);

// Use `Mediapipe` utils to get camera - lower resolution = higher fps
const camera = new Camera(videoElement, {
  onFrame: async () => {
    await holistic.send({ image: videoElement });
  },
  width: 640,
  height: 480,
});
camera.start();
// END MEDIAPIPE HOLISTIC INSTANCE

// Amazon addition 11-08-2023
const closeModal = function () {
  modal.classList.add("hidden");
  overlay.classList.add("hidden");
};

const openModal = function () {
  modal.classList.remove("hidden");
  overlay.classList.remove("hidden");
  tokenInput.focus();
};

overlay.addEventListener("click", closeModal);

openModalBtn.addEventListener("click", openModal);
submitBtn.addEventListener("click", async function (event) {
  // Get the input field's text value
  const prompt = tokenInput.value;
  // Create a JSON object with the text value

  closeModal();
});

const init = async () => {
  const avatarStream = renderer.domElement.captureStream();

  joinBtn.addEventListener("click", () => {
    if (tokenInput.value.length === 0) {
      openModal();
    } else {
      joinStage(avatarStream);
    }
  });
};

const joinStage = async (avatarStream) => {
  if (connected || joining) {
    return;
  }
  joining = true;
  joinBtn.addEventListener("click", () => {
    leaveStage();
    joinBtn.innerText = "Leave Stage";
  });
  const token = tokenInput.value;

  if (!token) {
    window.alert("Please enter a participant token");
    joining = false;
    return;
  }

  localMic = await navigator.mediaDevices.getUserMedia({
    video: false,
    audio: true,
  });

  avatarStageStream = new LocalStageStream(avatarStream.getVideoTracks()[0]);
  micStageStream = new LocalStageStream(localMic.getAudioTracks()[0]);

  const strategy = {
    stageStreamsToPublish() {
      return [avatarStageStream, micStageStream];
    },
    shouldPublishParticipant() {
      return true;
    },
    shouldSubscribeToParticipant() {
      return SubscribeType.AUDIO_VIDEO;
    },
  };

  stage = new Stage(token, strategy);

  // Other available events:
  // https://aws.github.io/amazon-ivs-web-broadcast/docs/sdk-guides/stages#events
  stage.on(StageEvents.STAGE_CONNECTION_STATE_CHANGED, (state) => {
    connected = state === ConnectionState.CONNECTED;

    if (connected) {
      joining = false;
    }
  });

  const leaveStage = async () => {
    stage.leave();

    joining = false;
    connected = false;
  };

  stage.on(StageEvents.STAGE_PARTICIPANT_JOINED, (participant) => {
    console.log("Participant Joined:", participant);
  });

  stage.on(StageEvents.STAGE_PARTICIPANT_STREAMS_ADDED, (participant, streams) => {
    console.log("Participant Media Added: ", participant, streams);
  });

  stage.on(StageEvents.STAGE_PARTICIPANT_LEFT, (participant) => {
    console.log("Participant Left: ", participant);
  });

  try {
    await stage.join();
  } catch (err) {
    joining = false;
    connected = false;
    console.error(err.message);
  }
};

document.addEventListener("DOMContentLoaded", function (event) {
  init();
});

// End Amazon addition
