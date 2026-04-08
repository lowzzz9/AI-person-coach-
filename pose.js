// pose.js — Body Tracking Engine (TensorFlow MoveNet — browser OpenCV equivalent)
// FILE TYPE: JavaScript Module
// Uses: @tensorflow-models/pose-detection (MoveNet) — most accurate browser pose tracker

class PoseTracker {
  constructor(videoEl, canvasEl) {
    this.video = videoEl;
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.detector = null;
    this.animFrame = null;
    this.isRunning = false;
    this.currentPose = null;
    this.onPose = null; // callback(pose)
    this.smoothedKeypoints = {};
    this.smoothingFactor = 0.6; // lower = smoother
  }

  async load() {
    const model = poseDetection.SupportedModels.MoveNet;
    this.detector = await poseDetection.createDetector(model, {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER, // higher accuracy
      enableSmoothing: true,
      minPoseScore: 0.25
    });
    console.log('[PoseTracker] MoveNet THUNDER loaded.');
    return this;
  }

  start() {
    this.isRunning = true;
    this._loop();
  }

  stop() {
    this.isRunning = false;
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _loop() {
    if (!this.isRunning) return;
    this.animFrame = requestAnimationFrame(async () => {
      await this._detect();
      this._loop();
    });
  }

  async _detect() {
    if (!this.video || this.video.readyState < 2 || !this.detector) return;

    // Sync canvas size
    if (this.canvas.width !== this.video.videoWidth) {
      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;
    }

    try {
      const poses = await this.detector.estimatePoses(this.video, {
        flipHorizontal: false
      });

      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      if (poses && poses.length > 0) {
        this.currentPose = poses[0];
        this._smooth(this.currentPose);
        this._draw(this.currentPose);
        if (this.onPose) this.onPose(this.currentPose);
      }
    } catch (e) {
      // swallow detection errors silently
    }
  }

  // Exponential smoothing for stable keypoints
  _smooth(pose) {
    pose.keypoints.forEach(kp => {
      if (!this.smoothedKeypoints[kp.name]) {
        this.smoothedKeypoints[kp.name] = { x: kp.x, y: kp.y };
      } else {
        const s = this.smoothedKeypoints[kp.name];
        const f = this.smoothingFactor;
        s.x = f * s.x + (1 - f) * kp.x;
        s.y = f * s.y + (1 - f) * kp.y;
        kp.x = s.x;
        kp.y = s.y;
      }
    });
  }

  _draw(pose) {
    const kps = pose.keypoints;
    const ctx = this.ctx;

    // Skeleton connections (MoveNet keypoint names)
    const CONNECTIONS = [
      ['left_shoulder','right_shoulder'],
      ['left_shoulder','left_elbow'],
      ['left_elbow','left_wrist'],
      ['right_shoulder','right_elbow'],
      ['right_elbow','right_wrist'],
      ['left_shoulder','left_hip'],
      ['right_shoulder','right_hip'],
      ['left_hip','right_hip'],
      ['left_hip','left_knee'],
      ['left_knee','left_ankle'],
      ['right_hip','right_knee'],
      ['right_knee','right_ankle'],
      ['left_ear','left_eye'],
      ['left_eye','nose'],
      ['nose','right_eye'],
      ['right_eye','right_ear'],
    ];

    const find = name => kps.find(k => k.name === name);

    // Draw bones
    CONNECTIONS.forEach(([a, b]) => {
      const p1 = find(a), p2 = find(b);
      if (p1 && p2 && p1.score > 0.25 && p2.score > 0.25) {
        // Gradient line
        const grad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
        grad.addColorStop(0, 'rgba(232,144,26,0.9)');
        grad.addColorStop(1, 'rgba(200,96,26,0.7)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    });

    // Draw joints
    kps.forEach(kp => {
      if (kp.score > 0.25) {
        // Outer glow
        ctx.beginPath();
        ctx.arc(kp.x, kp.y, 9, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(212,114,42,0.2)';
        ctx.fill();

        // Inner dot
        ctx.beginPath();
        ctx.arc(kp.x, kp.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#E8901A';
        ctx.shadowColor = '#E8901A';
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });

    // Draw angle label at key joints if score high enough
    this._drawAngleLabel(find('left_knee'), find('left_hip'), find('left_ankle'), ctx);
    this._drawAngleLabel(find('left_elbow'), find('left_shoulder'), find('left_wrist'), ctx);
  }

  _drawAngleLabel(joint, a, b, ctx) {
    if (!joint || !a || !b) return;
    if (joint.score < 0.4 || a.score < 0.4 || b.score < 0.4) return;
    const angle = Math.round(calcAngle(a, joint, b));
    ctx.font = 'bold 13px JetBrains Mono, monospace';
    ctx.fillStyle = '#F0A842';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 3;
    ctx.strokeText(`${angle}°`, joint.x + 10, joint.y - 10);
    ctx.fillText(`${angle}°`, joint.x + 10, joint.y - 10);
  }

  getKeypoints() {
    return this.currentPose ? this.currentPose.keypoints : null;
  }
}

window.PoseTracker = PoseTracker;
