// exercises.js — Exercise library with YouTube links and form data
// FILE TYPE: JavaScript ES Module

const EXERCISES = {
  squat: {
    name: "Squat",
    emoji: "🏋️",
    ytQuery: "perfect squat form tutorial",
    ytLink: "https://www.youtube.com/watch?v=aclHkVaku9U",
    ytEmbed: "aclHkVaku9U",
    caloriesPerRep: 0.5,
    targetAngle: 90,
    musclesWorked: ["Quadriceps", "Glutes", "Hamstrings", "Core"],
    steps: [
      { title: "Stance", desc: "Feet shoulder-width apart, toes slightly out", visual: "↔️", fix: "Keep feet firmly planted" },
      { title: "Chest Up", desc: "Look forward, not down", visual: "⬆️", fix: "Avoid rounding your back" },
      { title: "Descend", desc: "Lower hips back and down like sitting in a chair", visual: "🪑", fix: "Knees track over toes" },
      { title: "Depth", desc: "Thighs parallel to floor, 90° angle", visual: "📐", fix: "Don't let knees cave inward" },
      { title: "Drive Up", desc: "Push through heels explosively", visual: "🦶", fix: "Keep weight in heels" }
    ],
    mistakes: [
      { bad: "Knees caving inward (valgus collapse)", good: "Push knees outward, engage glutes" },
      { bad: "Heels lifting off ground", good: "Sit back more, keep weight in heels" },
      { bad: "Rounded lower back", good: "Engage core, keep chest up throughout" },
      { bad: "Shallow depth (quarter squat)", good: "Go until thighs are at least parallel" }
    ],
    // Pose analysis: checks knee angle and hip position
    analyze(keypoints, canvasH) {
      const lKnee = keypoints.find(k => k.name === 'left_knee');
      const rKnee = keypoints.find(k => k.name === 'right_knee');
      const lHip = keypoints.find(k => k.name === 'left_hip');
      const lAnkle = keypoints.find(k => k.name === 'left_ankle');
      const lShoulder = keypoints.find(k => k.name === 'left_shoulder');

      if (!lKnee || !lHip || !lAnkle || lKnee.score < 0.3) return null;

      // Calculate knee angle
      const kneeAngle = calcAngle(lHip, lKnee, lAnkle);
      const hipY = lHip.y;
      const kneeY = lKnee.y;
      const isDown = hipY > kneeY - 30;

      let score = 100, feedback = [], corrections = [], repSignal = false;

      if (isDown && kneeAngle < 120) {
        score -= 10;
        feedback.push("📐 Good depth! Drive through heels.");
        repSignal = true;
      } else if (kneeAngle >= 120 && kneeAngle < 160) {
        score -= 25;
        feedback.push("⚠️ Go deeper — aim for 90° knee angle.");
        corrections.push("Lower your hips more, like sitting in a chair.");
      } else {
        feedback.push("🏋️ Standing position — begin squatting down.");
        repSignal = false;
      }

      // Check back alignment
      if (lShoulder && lHip) {
        const backLean = Math.abs(lShoulder.x - lHip.x);
        if (backLean > 80) {
          score -= 20;
          corrections.push("Keep chest up, don't lean too far forward.");
        }
      }

      return { score, feedback, corrections, repSignal, angle: Math.round(kneeAngle) };
    }
  },

  pushup: {
    name: "Push-up",
    emoji: "💪",
    ytQuery: "perfect push up form tutorial",
    ytLink: "https://www.youtube.com/watch?v=IODxDxX7oi4",
    ytEmbed: "IODxDxX7oi4",
    caloriesPerRep: 0.4,
    targetAngle: 90,
    musclesWorked: ["Chest", "Triceps", "Shoulders", "Core"],
    steps: [
      { title: "Plank Position", desc: "Hands shoulder-width apart, wrists under shoulders", visual: "🖐️", fix: "Wrists directly below shoulders" },
      { title: "Body Line", desc: "Straight line from head to heels", visual: "📏", fix: "No sagging or piking hips" },
      { title: "Descend", desc: "Lower chest toward ground, elbows 45°", visual: "📐", fix: "Don't flare elbows wide" },
      { title: "Full Range", desc: "Chest nearly touches ground", visual: "⬇️", fix: "Control the descent slowly" },
      { title: "Push Up", desc: "Exhale, extend arms fully", visual: "⬆️", fix: "Lock out at top" }
    ],
    mistakes: [
      { bad: "Elbows flaring out (90°)", good: "Keep elbows at 45° to body, engage lats" },
      { bad: "Sagging hips (banana back)", good: "Squeeze glutes and core to straighten" },
      { bad: "Partial range of motion", good: "Full ROM for maximum benefit" },
      { bad: "Head dropping forward", good: "Keep neutral neck, look at floor ahead" }
    ],
    analyze(keypoints, canvasH) {
      const lShoulder = keypoints.find(k => k.name === 'left_shoulder');
      const lElbow = keypoints.find(k => k.name === 'left_elbow');
      const lWrist = keypoints.find(k => k.name === 'left_wrist');
      const lHip = keypoints.find(k => k.name === 'left_hip');
      const lAnkle = keypoints.find(k => k.name === 'left_ankle');

      if (!lShoulder || !lElbow || !lHip || lShoulder.score < 0.3) return null;

      let score = 100, feedback = [], corrections = [], repSignal = false;
      let angle = null;

      if (lElbow) {
        angle = calcAngle(lShoulder, lElbow, lWrist || lShoulder);
      }

      // Hip alignment (straight body)
      if (lHip && lAnkle) {
        const bodyAngle = calcAngle(lShoulder, lHip, lAnkle);
        if (bodyAngle < 150) {
          score -= 30;
          corrections.push("Tighten core and glutes — your body should be a straight line.");
        }
      }

      // Elbow angle for rep detection
      if (angle !== null) {
        if (angle < 90) {
          feedback.push("💪 Great depth! Push back up.");
          repSignal = true;
        } else if (angle < 130) {
          score -= 15;
          feedback.push("⬇️ Lower your chest more.");
          corrections.push("Go lower for full range of motion.");
        } else {
          feedback.push("💪 Good top position — start lowering.");
        }
      }

      return { score, feedback, corrections, repSignal, angle: angle ? Math.round(angle) : null };
    }
  },

  lunge: {
    name: "Lunge",
    emoji: "🦵",
    ytQuery: "perfect lunge form tutorial",
    ytLink: "https://www.youtube.com/watch?v=QOVaHwm-Q6U",
    ytEmbed: "QOVaHwm-Q6U",
    caloriesPerRep: 0.6,
    targetAngle: 90,
    musclesWorked: ["Quadriceps", "Glutes", "Hamstrings", "Balance"],
    steps: [
      { title: "Stand Tall", desc: "Feet hip-width, step forward", visual: "🚶", fix: "Keep torso upright" },
      { title: "Lower Down", desc: "Front knee bends to 90°", visual: "📐", fix: "Knee stays behind toes" },
      { title: "Back Knee", desc: "Hover back knee 1 inch off floor", visual: "🦵", fix: "Maintain 90° back knee angle" },
      { title: "Drive Up", desc: "Push through front heel", visual: "⬆️", fix: "Keep weight centered" },
      { title: "Alternate", desc: "Switch legs each rep", visual: "🔄", fix: "Balance equally both sides" }
    ],
    mistakes: [
      { bad: "Front knee past toes", good: "Take larger step forward" },
      { bad: "Torso leaning forward", good: "Keep chest up, core tight" },
      { bad: "Back knee slamming ground", good: "Slow controlled descent" },
      { bad: "Narrow stance (wobbly)", good: "Step forward AND slightly out" }
    ],
    analyze(keypoints) {
      const lKnee = keypoints.find(k => k.name === 'left_knee');
      const rKnee = keypoints.find(k => k.name === 'right_knee');
      const lHip = keypoints.find(k => k.name === 'left_hip');
      const lAnkle = keypoints.find(k => k.name === 'left_ankle');
      const lShoulder = keypoints.find(k => k.name === 'left_shoulder');

      if (!lKnee || !rKnee || lKnee.score < 0.3) return null;

      let score = 100, feedback = [], corrections = [], repSignal = false;
      const kneeDiff = Math.abs(lKnee.y - rKnee.y);
      const angle = lHip && lAnkle ? Math.round(calcAngle(lHip, lKnee, lAnkle)) : null;

      if (kneeDiff > 60) {
        feedback.push("🦵 Excellent lunge depth! Keep torso upright.");
        repSignal = true;
      } else if (kneeDiff > 30) {
        score -= 20;
        feedback.push("⚠️ Lunge deeper — get front knee to 90°.");
        corrections.push("Take a bigger step forward, lower your hips more.");
      } else {
        feedback.push("🦵 Step forward into your lunge.");
      }

      return { score, feedback, corrections, repSignal, angle };
    }
  },

  plank: {
    name: "Plank",
    emoji: "🧘",
    ytQuery: "perfect plank form tutorial",
    ytLink: "https://www.youtube.com/watch?v=pSHjTRCQxIw",
    ytEmbed: "pSHjTRCQxIw",
    caloriesPerRep: 0.15,
    targetAngle: 180,
    musclesWorked: ["Core", "Transverse Abdominis", "Shoulders", "Glutes"],
    steps: [
      { title: "Elbows Under Shoulders", desc: "Forearms flat on ground", visual: "💪", fix: "Stack shoulders directly above elbows" },
      { title: "Straight Line", desc: "Head to heels perfectly aligned", visual: "📏", fix: "No sagging or piking" },
      { title: "Core Braced", desc: "Pull belly button toward spine", visual: "🎯", fix: "Brace like absorbing a punch" },
      { title: "Glutes Squeezed", desc: "Full body tension activated", visual: "🔒", fix: "Don't let hips drop" },
      { title: "Breathe", desc: "Steady rhythmic breathing", visual: "⏱️", fix: "Don't hold your breath" }
    ],
    mistakes: [
      { bad: "Sagging hips (low back collapse)", good: "Engage core, squeeze glutes hard" },
      { bad: "Hips too high (downward dog)", good: "Lower hips to form straight line" },
      { bad: "Holding breath", good: "Exhale slowly, maintain tension" },
      { bad: "Head drooping down", good: "Neutral neck, gaze at floor" }
    ],
    analyze(keypoints) {
      const lShoulder = keypoints.find(k => k.name === 'left_shoulder');
      const lHip = keypoints.find(k => k.name === 'left_hip');
      const lAnkle = keypoints.find(k => k.name === 'left_ankle');

      if (!lShoulder || !lHip || lShoulder.score < 0.3) return null;

      let score = 100, feedback = [], corrections = [], repSignal = false;
      let angle = null;

      if (lAnkle) {
        angle = Math.round(calcAngle(lShoulder, lHip, lAnkle));
        const deviation = Math.abs(180 - angle);

        if (deviation < 15) {
          feedback.push("🧘 Perfect plank! Hold and breathe.");
          score = 100;
          repSignal = true; // for plank = holding
        } else if (deviation < 30) {
          score -= 20;
          feedback.push("⚠️ Slight hip sag — tighten your core!");
          corrections.push("Squeeze glutes, pull belly button to spine.");
        } else {
          score -= 45;
          feedback.push("❌ Hips sagging badly — fix form now!");
          corrections.push("Engage core fully, keep body in straight line.");
        }
      } else {
        feedback.push("🧘 Hold your plank position steady.");
      }

      return { score, feedback, corrections, repSignal, angle };
    }
  },

  deadlift: {
    name: "Deadlift",
    emoji: "🏗️",
    ytQuery: "perfect deadlift form tutorial",
    ytLink: "https://www.youtube.com/watch?v=op9kVnSso6Q",
    ytEmbed: "op9kVnSso6Q",
    caloriesPerRep: 0.8,
    targetAngle: 180,
    musclesWorked: ["Hamstrings", "Glutes", "Lower Back", "Traps"],
    steps: [
      { title: "Hip Hinge", desc: "Push hips back, maintain neutral spine", visual: "🔙", fix: "Hinge at hips, not waist" },
      { title: "Bar Position", desc: "Bar over mid-foot, arms vertical", visual: "⬇️", fix: "Keep bar close to shins" },
      { title: "Chest Up", desc: "Proud chest, lats engaged", visual: "💪", fix: "No rounded shoulders" },
      { title: "Drive Through Heels", desc: "Push floor away, extend hips", visual: "⬆️", fix: "Hips and bar rise together" },
      { title: "Lock Out", desc: "Stand tall, hips fully extended", visual: "🏆", fix: "Don't hyperextend back" }
    ],
    mistakes: [
      { bad: "Rounding lower back", good: "Neutral spine throughout entire lift" },
      { bad: "Bar drifting away from body", good: "Keep bar dragging up shins" },
      { bad: "Jerking the bar up", good: "Smooth, controlled acceleration" },
      { bad: "Knees caving in", good: "Push knees out, screw feet into floor" }
    ],
    analyze(keypoints) {
      const lShoulder = keypoints.find(k => k.name === 'left_shoulder');
      const lHip = keypoints.find(k => k.name === 'left_hip');
      const lKnee = keypoints.find(k => k.name === 'left_knee');

      if (!lShoulder || !lHip || !lKnee || lHip.score < 0.3) return null;

      let score = 100, feedback = [], corrections = [], repSignal = false;
      const angle = Math.round(calcAngle(lShoulder, lHip, lKnee));

      if (angle > 160) {
        feedback.push("🏗️ Standing — hip hinge to begin.");
      } else if (angle < 90) {
        feedback.push("✅ Good hip hinge depth!");
        repSignal = true;
      } else {
        feedback.push("⚠️ Push hips further back.");
        corrections.push("Drive hips back while keeping chest up.");
        score -= 20;
      }

      return { score, feedback, corrections, repSignal, angle };
    }
  },

  bicepCurl: {
    name: "Bicep Curl",
    emoji: "💪",
    ytQuery: "perfect bicep curl form tutorial",
    ytLink: "https://www.youtube.com/watch?v=ykJmrZ5v0Oo",
    ytEmbed: "ykJmrZ5v0Oo",
    caloriesPerRep: 0.2,
    targetAngle: 45,
    musclesWorked: ["Biceps", "Forearms", "Brachialis"],
    steps: [
      { title: "Stand Tall", desc: "Elbows tucked to sides", visual: "🧍", fix: "Don't swing torso" },
      { title: "Curl Up", desc: "Supinate wrists as you curl", visual: "🔄", fix: "Full supination at top" },
      { title: "Peak Contraction", desc: "Squeeze bicep hard at top", visual: "💪", fix: "Hold for 1 second" },
      { title: "Slow Down", desc: "3-second controlled descent", visual: "⬇️", fix: "Don't drop weight fast" },
      { title: "Full Extension", desc: "Fully straighten arm at bottom", visual: "↕️", fix: "Full ROM every rep" }
    ],
    mistakes: [
      { bad: "Swinging body (momentum cheat)", good: "Strict form, elbows pinned to sides" },
      { bad: "Partial range of motion", good: "Full extension and full curl" },
      { bad: "Wrists collapsing", good: "Keep wrists neutral and strong" },
      { bad: "Elbows flaring forward", good: "Keep elbows stationary at sides" }
    ],
    analyze(keypoints) {
      const lShoulder = keypoints.find(k => k.name === 'left_shoulder');
      const lElbow = keypoints.find(k => k.name === 'left_elbow');
      const lWrist = keypoints.find(k => k.name === 'left_wrist');

      if (!lShoulder || !lElbow || !lWrist || lElbow.score < 0.3) return null;

      let score = 100, feedback = [], corrections = [], repSignal = false;
      const angle = Math.round(calcAngle(lShoulder, lElbow, lWrist));

      if (angle < 60) {
        feedback.push("💪 Full curl! Squeeze at the top.");
        repSignal = true;
      } else if (angle < 120) {
        feedback.push("⬆️ Keep curling up.");
        score -= 10;
      } else {
        feedback.push("↕️ Start your curl from full extension.");
      }

      return { score, feedback, corrections, repSignal, angle };
    }
  }
};

// Utility: Calculate angle between 3 points (in degrees)
function calcAngle(a, b, c) {
  if (!a || !b || !c) return 180;
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs(radians * 180.0 / Math.PI);
  if (angle > 180.0) angle = 360 - angle;
  return angle;
}

// Export
window.EXERCISES = EXERCISES;
window.calcAngle = calcAngle;
