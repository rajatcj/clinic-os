/**
 * Clinical Simulation — Firebase Integration Module
 * ─────────────────────────────────────────────────────────────────────────
 * Handles: Auth, Firestore reads/writes, score submission, visitor counters,
 *          leaderboard, badge awards, username uniqueness checks.
 *
 * SETUP INSTRUCTIONS
 * ──────────────────
 * 1. Go to console.firebase.google.com → Create project → "medsim-nepal"
 * 2. Enable Authentication → Sign-in methods: Email/Password + Google
 * 3. Enable Firestore Database → Start in production mode → Region: asia-south1
 * 4. Replace the firebaseConfig object below with YOUR project's config
 *    (Project Settings → General → Your apps → SDK setup)
 * 5. Deploy Firestore security rules (see SECURITY_RULES section at bottom)
 * 6. Create composite indexes when Firestore prompts you on first query run
 *
 * ANTI-CHEAT ARCHITECTURE
 * ────────────────────────
 * Scores are NOT computed on client and pushed directly.
 * Instead, the raw game event log (actions taken, tests ordered, time elapsed)
 * is submitted. The server-side Cloud Function re-runs scoring against the
 * canonical case JSON stored in Firestore and writes the verified score.
 * Client-computed score is only used for immediate UI display.
 * If client score ≠ server score by >5 points, the server score wins and
 * a flag is set on the scoreLog document for review.
 */
// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider,
  signOut, updateProfile, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, addDoc,
  collection, query, where, orderBy, limit, getDocs,
  runTransaction, serverTimestamp, increment, arrayUnion,
  writeBatch, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getFunctions, httpsCallable
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

// ── YOUR FIREBASE CONFIG ─────────────────────────────────────────────────
// Replace this with the config from your Firebase project settings
// const firebaseConfig = {
//   apiKey:            "YOUR_API_KEY",
//   authDomain:        "YOUR_PROJECT.firebaseapp.com",
//   projectId:         "YOUR_PROJECT_ID",
//   storageBucket:     "YOUR_PROJECT.appspot.com",
//   messagingSenderId: "YOUR_SENDER_ID",
//   appId:             "YOUR_APP_ID",
//   measurementId:     "YOUR_MEASUREMENT_ID"
// };


   // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  const firebaseConfig = {
    apiKey: "AIzaSyByHm5CvMK2GLcciEFjwfFzkcS23eduko0",
    authDomain: "clinic-case-os.firebaseapp.com",
    projectId: "clinic-case-os",
    storageBucket: "clinic-case-os.firebasestorage.app",
    messagingSenderId: "588710608362",
    appId: "1:588710608362:web:7f49b21be5d55bd7cfc693",
    measurementId: "G-HS0MXGP5SB"
  };



// ── Init ─────────────────────────────────────────────────────────────────
const app       = initializeApp(firebaseConfig);
const auth      = getAuth(app);
const db        = getFirestore(app);
const functions = getFunctions(app, 'asia-south1');

// ── Auth state observable (call this from any page) ───────────────────────
/**
 * Subscribe to auth state. cb is called immediately with current user (or null).
 * Returns unsubscribe function.
 *
 * Usage:
 *   const unsub = MedSim.onAuthChange(user => {
 *     if (user) showLoggedInUI(user);
 *     else showLoginUI();
 *   });
 */
function onAuthChange(cb) {
  return onAuthStateChanged(auth, cb);
}

// ── Current user shorthand ────────────────────────────────────────────────
function currentUser() {
  return auth.currentUser;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTHENTICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sign up with email + password.
 * Does NOT create Firestore profile — call createUserProfile() after.
 */
async function signUpEmail(email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return cred.user;
}

/**
 * Sign in with email + password.
 */
async function signInEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

/**
 * Sign in with Google OAuth popup.
 */
async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

/**
 * Sign out current user.
 */
async function logOut() {
  await signOut(auth);
}

/**
 * Send password reset email.
 */
async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

// ═══════════════════════════════════════════════════════════════════════════
// USER PROFILE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a username is already taken.
 * Returns true if available, false if taken.
 *
 * Username rules enforced here: 3–20 chars, alphanumeric + underscore only.
 */
async function isUsernameAvailable(username) {
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    throw new Error('Username must be 3–20 characters: letters, numbers, underscores only.');
  }
  const snap = await getDoc(doc(db, 'usernames', username.toLowerCase()));
  return !snap.exists();
}

/**
 * Create a new user profile in Firestore.
 * Call this after signup / first Google login when profile doesn't exist yet.
 *
 * @param {string} uid        - Firebase auth UID
 * @param {string} username   - Chosen unique username
 * @param {string} displayName
 * @param {string} bio
 */
async function createUserProfile(uid, username, displayName, bio = '') {
  const usernameLower = username.toLowerCase();

  // Check uniqueness first
  const available = await isUsernameAvailable(username);
  if (!available) throw new Error('Username is already taken.');

  const batch = writeBatch(db);

  // users/{uid}
  batch.set(doc(db, 'users', uid), {
    uid,
    username,
    usernameLower,
    displayName: displayName || username,
    bio,
    avatarUrl:         '',
    joinedAt:          serverTimestamp(),
    tags:              [],
    badges:            [],
    totalCasesPlayed:  0,
    totalCasesSolved:  0,
    totalCasesAttempted: 0,
    averageScore:      0,
    totalTimePlayed:   0,   // seconds
    bestScores:        {},  // { caseId: score }
  });

  // usernames/{usernameLower} — for uniqueness + reverse lookup
  batch.set(doc(db, 'usernames', usernameLower), { uid });

  await batch.commit();

  // Also update Firebase Auth display name
  if (auth.currentUser) {
    await updateProfile(auth.currentUser, { displayName: displayName || username });
  }
}

/**
 * Check if a user profile exists in Firestore.
 * Returns the profile object or null.
 */
async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}

/**
 * Get a profile by username (for public profile pages).
 * Returns { uid, ...profileData } or null.
 */
async function getProfileByUsername(username) {
  const usernameLower = username.toLowerCase();
  const usernameSnap  = await getDoc(doc(db, 'usernames', usernameLower));
  if (!usernameSnap.exists()) return null;
  const { uid } = usernameSnap.data();
  return await getUserProfile(uid);
}

/**
 * Update editable profile fields.
 * Only displayName and bio can be self-edited.
 * Tags are admin-only (set via Firebase console or admin function).
 */
async function updateUserProfile(uid, { displayName, bio }) {
  const updates = {};
  if (displayName !== undefined) updates.displayName = displayName;
  if (bio         !== undefined) updates.bio = bio;
  await updateDoc(doc(db, 'users', uid), updates);

  if (auth.currentUser && displayName) {
    await updateProfile(auth.currentUser, { displayName });
  }
}

/**
 * Search users by username prefix.
 * Returns array of profile objects (max 10).
 *
 * Firestore prefix search: username >= term AND username <= term + \uf8ff
 */
async function searchUsers(term) {
  if (!term || term.length < 2) return [];
  const lower = term.toLowerCase();
  const q = query(
    collection(db, 'users'),
    where('usernameLower', '>=', lower),
    where('usernameLower', '<=', lower + '\uf8ff'),
    orderBy('usernameLower'),
    limit(10)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}

// ═══════════════════════════════════════════════════════════════════════════
// SCORE SUBMISSION (anti-cheat via Cloud Function)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Submit game results after a case ends.
 *
 * The raw event log and final game state are sent to a Cloud Function that:
 *   1. Re-reads the canonical case scoring rubric from Firestore
 *   2. Re-runs the scoring algorithm server-side
 *   3. Writes the verified score to scoreLog and updates the leaderboard
 *   4. Awards badges if applicable
 *   5. Updates user aggregate stats
 *
 * The client receives the server-verified score back.
 *
 * @param {string} caseId     - e.g. "fever_abd_001"
 * @param {object} gameState  - engine.getState() at case end
 * @param {object} clientScore - engine.calculateScore() — for immediate UI;
 *                              server will override if mismatch
 * @param {Array}  eventLog   - engine.log array (full action history)
 *
 * Returns: { verifiedScore, grade, badgesAwarded, leaderboardRank, alreadyBest }
 */
async function submitGameResult(caseId, gameState, clientScore, eventLog) {
  const user = currentUser();
  if (!user) throw new Error('Must be logged in to submit scores.');

  const submitScore = httpsCallable(functions, 'submitScore');
  const result = await submitScore({
    caseId,
    uid:         user.uid,
    username:    (await getUserProfile(user.uid))?.username || user.uid,
    gameState:   _sanitiseStateForSubmit(gameState),
    clientScore: clientScore.score,
    eventLog:    eventLog.slice(-200), // cap at last 200 events to prevent huge payloads
    submittedAt: Date.now(),
  });

  return result.data;
}

/**
 * Strip potentially large/irrelevant fields before sending to server.
 */
function _sanitiseStateForSubmit(state) {
  return {
    stage:              state.stage,
    time:               state.time,
    budget:             state.budget,
    cost:               state.cost,
    penalty:            state.penalty,
    cured:              state.cured,
    outcome:            state.outcome,
    selectedDiagnosis:  state.selectedDiagnosis,
    diagnosisCorrect:   state.diagnosisCorrect,
    completedTests:     state.completedTests.map(t => ({ testId: t.testId, stage: t.stage })),
    givenManagement:    state.givenManagement.map(m => ({ id: m.id, category: m.category })),
    activeSymptoms:     state.activeSymptoms,
    vitals:             state.vitals,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SCORE LOG & HISTORY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all score log entries for a user (their play history).
 * Returns array sorted by most recent first.
 */
async function getUserScoreLog(uid, limitCount = 20) {
  const q = query(
    collection(db, 'scoreLog'),
    where('uid', '==', uid),
    orderBy('playedAt', 'desc'),
    limit(limitCount)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Get a user's best score for a specific case.
 * Returns the scoreLog entry or null.
 */
async function getUserBestScore(uid, caseId) {
  const q = query(
    collection(db, 'scoreLog'),
    where('uid', '==', uid),
    where('caseId', '==', caseId),
    orderBy('score', 'desc'),
    limit(1)
  );
  const snap = await getDocs(q);
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ═══════════════════════════════════════════════════════════════════════════
// LEADERBOARD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get top N entries for a case leaderboard.
 * Each entry = best score per unique user for that case.
 * Sorted by score desc, then timeElapsed asc (faster = better tiebreak).
 *
 * Returns array of leaderboard entries.
 */
async function getCaseLeaderboard(caseId, topN = 10) {
  const q = query(
    collection(db, 'leaderboard', caseId, 'entries'),
    orderBy('score', 'desc'),
    orderBy('timeElapsed', 'asc'),
    limit(topN)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d, i) => ({ rank: i + 1, id: d.id, ...d.data() }));
}

/**
 * Get the current user's leaderboard entry for a case (their personal best).
 */
async function getMyLeaderboardEntry(caseId) {
  const user = currentUser();
  if (!user) return null;
  const snap = await getDoc(doc(db, 'leaderboard', caseId, 'entries', user.uid));
  return snap.exists() ? snap.data() : null;
}

/**
 * Real-time leaderboard subscription.
 * Calls cb whenever top 10 changes.
 * Returns unsubscribe function.
 */
function subscribeLeaderboard(caseId, cb, topN = 10) {
  const q = query(
    collection(db, 'leaderboard', caseId, 'entries'),
    orderBy('score', 'desc'),
    orderBy('timeElapsed', 'asc'),
    limit(topN)
  );
  return onSnapshot(q, snap => {
    const entries = snap.docs.map((d, i) => ({ rank: i + 1, id: d.id, ...d.data() }));
    cb(entries);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// CASE METADATA & COUNTERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get case metadata from Firestore (play counts, average score, etc).
 * The actual case JSON (with all game logic) stays on your file system.
 * This only stores lightweight counters and aggregates.
 */
async function getCaseMeta(caseId) {
  const snap = await getDoc(doc(db, 'cases', caseId));
  return snap.exists() ? snap.data() : null;
}

/**
 * Increment the case play counter.
 * Call this when a user STARTS a case (presses "Begin Simulation").
 *
 * The Cloud Function handles uniquePlayer counting — it checks if the user
 * has a leaderboard entry before incrementing totalUniquePlayers.
 */
async function recordCaseStart(caseId) {
  const user = currentUser();
  if (!user) return; // guests don't count in unique players

  // We let the Cloud Function handle the atomic unique-player check.
  // This client call only increments the raw totalPlays counter.
  const ref = doc(db, 'cases', caseId);
  await updateDoc(ref, { totalPlays: increment(1) }).catch(async () => {
    // Document may not exist yet — create it
    await setDoc(ref, {
      caseId,
      totalPlays: 1,
      totalUniquePlayers: 0,
      averageScore: 0,
      averageTime: 0,
    }, { merge: true });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// VISITOR COUNTERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record a website visit.
 * Call once per session (checks sessionStorage to avoid double-counting
 * on the same tab).
 *
 * Increments:
 *   - analytics/global.totalVisitors  (all-time)
 *   - analytics/global.todayVisitors  (resets daily)
 */
async function recordVisit() {
  // Only count once per browser session
  if (sessionStorage.getItem('msn_visit_counted')) return;
  sessionStorage.setItem('msn_visit_counted', '1');

  const todayStr = new Date().toISOString().split('T')[0]; // "2026-04-25"
  const ref = doc(db, 'analytics', 'global');

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        tx.set(ref, {
          totalVisitors: 1,
          todayVisitors: 1,
          todayDate: todayStr,
        });
      } else {
        const d = snap.data();
        if (d.todayDate === todayStr) {
          tx.update(ref, {
            totalVisitors: increment(1),
            todayVisitors: increment(1),
          });
        } else {
          // New day — reset daily counter
          tx.update(ref, {
            totalVisitors: increment(1),
            todayVisitors: 1,
            todayDate: todayStr,
          });
        }
      }
    });
  } catch (e) {
    // Non-critical — silently fail visitor counting
    console.warn('Visitor counter failed:', e.message);
  }
}

/**
 * Get current visitor counts.
 * Returns { totalVisitors, todayVisitors } or default zeros.
 */
async function getVisitorCounts() {
  const snap = await getDoc(doc(db, 'analytics', 'global'));
  if (!snap.exists()) return { totalVisitors: 0, todayVisitors: 0 };
  const d = snap.data();
  const todayStr = new Date().toISOString().split('T')[0];
  return {
    totalVisitors: d.totalVisitors || 0,
    todayVisitors: d.todayDate === todayStr ? (d.todayVisitors || 0) : 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// BADGE SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

// Badge definitions — evaluated client-side after game end,
// then written to Firestore (server also re-checks via Cloud Function)
const BADGE_DEFINITIONS = [
  {
    id:          'first_blood',
    name:        'First Diagnosis',
    description: 'Completed your first case.',
    icon:        '🩺',
    check:       (profile, _score) => profile.totalCasesPlayed === 0, // first ever
  },
  {
    id:          'perfect_score',
    name:        'Textbook Clinician',
    description: 'Scored 95% or above on any case.',
    icon:        '⭐',
    check:       (_p, score) => score.score >= 95,
  },
  {
    id:          'speed_clinician',
    name:        'Speed Clinician',
    description: 'Completed a case in under 10 minutes of real time.',
    icon:        '⚡',
    check:       (_p, score) => score.realTimeSeconds < 600,
  },
  {
    id:          'budget_master',
    name:        'Budget Master',
    description: 'Spent under 40% of budget and still cured the patient.',
    icon:        '💰',
    check:       (_p, score) => score.cured && (score.cost / score.budget) < 0.4,
  },
  {
    id:          'no_blunders',
    name:        'First, Do No Harm',
    description: 'Completed a case with zero blunder management choices.',
    icon:        '🛡️',
    check:       (_p, score) => score.cured && score.penalty === 0,
  },
  {
    id:          'diagnostician',
    name:        'Senior Diagnostician',
    description: 'Correctly diagnosed 10 different cases.',
    icon:        '🔬',
    check:       (profile, _score) => profile.totalCasesSolved >= 10,
  },
  {
    id:          'veteran',
    name:        'Veteran',
    description: 'Played 25 or more cases.',
    icon:        '🎖️',
    check:       (profile, _score) => profile.totalCasesPlayed >= 25,
  },
  {
    id:          'resident_grade',
    name:        'Resident Level',
    description: 'Achieved an average score of 75+ across 5 cases.',
    icon:        '📋',
    check:       (profile, _score) => profile.averageScore >= 75 && profile.totalCasesPlayed >= 5,
  },
];

/**
 * Evaluate which badges should be awarded after a game ends.
 * Returns array of badge IDs to award (those not already held).
 */
function evaluateBadges(userProfile, scoreResult) {
  const already = new Set(userProfile.badges || []);
  return BADGE_DEFINITIONS
    .filter(b => !already.has(b.id) && b.check(userProfile, scoreResult))
    .map(b => b.id);
}

/**
 * Award badges to a user (writes to Firestore).
 * Also returns the badge definition objects for display.
 * NOTE: The Cloud Function also independently awards badges server-side.
 * Client-side award is for immediate UI feedback only.
 */
async function awardBadges(uid, badgeIds) {
  if (!badgeIds.length) return [];
  await updateDoc(doc(db, 'users', uid), {
    badges: arrayUnion(...badgeIds),
  });
  return badgeIds.map(id => BADGE_DEFINITIONS.find(b => b.id === id)).filter(Boolean);
}

// ═══════════════════════════════════════════════════════════════════════════
// CLOUD FUNCTION — submitScore (deploy this to functions/index.js)
// ═══════════════════════════════════════════════════════════════════════════
// This is the server-side function source for reference.
// You'll need the Firebase Functions SDK to deploy this.
// It is NOT executed in the browser — copy it to your functions/ folder.
//
// The function:
//   1. Validates the submission
//   2. Looks up the scoring rubric for the case from Firestore (not client)
//   3. Re-runs the scoring algorithm
//   4. Writes scoreLog, updates leaderboard, updates user stats
//   5. Awards badges
//   6. Returns verified score
//
// Minimal stub shown here. Full implementation in the functions file.
/*
exports.submitScore = functions
  .region('asia-south1')
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');

    const { caseId, uid, username, gameState, clientScore, eventLog } = data;

    // 1. Verify uid matches auth token
    if (context.auth.uid !== uid) throw new functions.https.HttpsError('permission-denied', 'UID mismatch');

    // 2. Load case scoring rubric from Firestore (canonical source of truth)
    const caseMetaSnap = await admin.firestore().doc(`cases/${caseId}`).get();
    const caseMeta = caseMetaSnap.data();

    // 3. Server-side score computation
    // (Mirrors ClinicalEngine.calculateScore() logic but using server-side case data)
    const serverScore = computeScore(gameState, caseMeta, eventLog);

    // 4. Detect mismatch
    const mismatch = Math.abs(serverScore.score - clientScore) > 5;

    // 5. Write scoreLog
    const logRef = await admin.firestore().collection('scoreLog').add({
      uid, username, caseId,
      score: serverScore.score,
      grade: serverScore.grade,
      diagnosisCorrect: gameState.diagnosisCorrect,
      timeElapsed: Math.round(gameState.time * 3600),
      budgetUsed: gameState.cost,
      budgetTotal: gameState.budget,
      outcome: gameState.outcome,
      finalStage: gameState.stage,
      cured: gameState.cured,
      penaltyTotal: gameState.penalty,
      testsOrdered: gameState.completedTests.map(t => t.testId),
      managementGiven: gameState.givenManagement.map(m => m.id),
      clientScore,
      mismatchFlag: mismatch,
      playedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 6. Update leaderboard (best score only)
    const lbRef = admin.firestore().doc(`leaderboard/${caseId}/entries/${uid}`);
    const lbSnap = await lbRef.get();
    let leaderboardRank = null;
    let alreadyBest = false;
    if (!lbSnap.exists() || lbSnap.data().score < serverScore.score) {
      await lbRef.set({
        uid, username,
        score: serverScore.score,
        grade: serverScore.grade,
        timeElapsed: Math.round(gameState.time * 3600),
        budgetUsed: gameState.cost,
        diagnosisCorrect: gameState.diagnosisCorrect,
        outcome: gameState.outcome,
        playedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      alreadyBest = true;
    }

    // 7. Update user aggregate stats
    const userRef = admin.firestore().doc(`users/${uid}`);
    const userSnap = await userRef.get();
    const userData = userSnap.data();
    const prevAvg = userData.averageScore || 0;
    const prevCount = userData.totalCasesPlayed || 0;
    const newAvg = ((prevAvg * prevCount) + serverScore.score) / (prevCount + 1);
    const solvedIncrement = gameState.cured ? 1 : 0;

    await userRef.update({
      totalCasesPlayed: admin.firestore.FieldValue.increment(1),
      totalCasesSolved: admin.firestore.FieldValue.increment(solvedIncrement),
      averageScore: Math.round(newAvg * 10) / 10,
      totalTimePlayed: admin.firestore.FieldValue.increment(Math.round(gameState.time * 3600)),
    });

    // 8. Unique player check + counter
    if (!lbSnap.exists()) {
      await admin.firestore().doc(`cases/${caseId}`).update({
        totalUniquePlayers: admin.firestore.FieldValue.increment(1),
      });
    }

    // 9. Badge evaluation
    const userDataUpdated = (await userRef.get()).data();
    const badgesEarned = [];
    // [badge evaluation logic here — mirrors client BADGE_DEFINITIONS]
    // Write to user doc: await userRef.update({ badges: admin.firestore.FieldValue.arrayUnion(...badgesEarned) });

    return {
      verifiedScore: serverScore.score,
      grade: serverScore.grade,
      badgesAwarded: badgesEarned,
      alreadyBest,
    };
  });
*/

// ═══════════════════════════════════════════════════════════════════════════
// FIRESTORE SECURITY RULES (deploy via firebase deploy --only firestore:rules)
// ═══════════════════════════════════════════════════════════════════════════
/*
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Users can read any profile, only write their own (except tags — admin only)
    match /users/{uid} {
      allow read: if true;
      allow create: if request.auth.uid == uid
                    && !('tags' in request.resource.data);
      allow update: if request.auth.uid == uid
                    && !('tags' in request.resource.data)
                    && !('badges' in request.resource.data);
      // tags and badges are written only by Cloud Functions (admin SDK bypasses rules)
    }

    // Username uniqueness documents
    match /usernames/{username} {
      allow read: if true;
      allow write: if request.auth != null
                   && request.resource.data.uid == request.auth.uid;
    }

    // Score log — read own, write only via Cloud Function (admin SDK)
    match /scoreLog/{docId} {
      allow read: if request.auth != null
                  && resource.data.uid == request.auth.uid;
      allow write: if false; // server-side only
    }

    // Leaderboard — public read, server-side write only
    match /leaderboard/{caseId}/entries/{uid} {
      allow read: if true;
      allow write: if false; // server-side only
    }

    // Case metadata — public read, server-side write only
    match /cases/{caseId} {
      allow read: if true;
      allow write: if false; // totalPlays increment handled by function
    }

    // Analytics — public read, controlled write
    match /analytics/{docId} {
      allow read: if true;
      allow write: if request.auth == null || request.auth != null; // open for visitor counting
      // If abused, move visitor counting to Cloud Function too
    }
  }
}
*/

// ═══════════════════════════════════════════════════════════════════════════
// FIRESTORE INDEXES NEEDED
// ═══════════════════════════════════════════════════════════════════════════
// Add these in Firebase Console → Firestore → Indexes → Composite:
//
// Collection: scoreLog
//   Fields: uid ASC, playedAt DESC
//
// Collection: scoreLog
//   Fields: uid ASC, caseId ASC, score DESC
//
// Collection: leaderboard/{caseId}/entries  (subcollection)
//   Fields: score DESC, timeElapsed ASC
//
// Collection: users
//   Fields: usernameLower ASC

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════
export const MedSim = {
  // Auth
  onAuthChange,
  currentUser,
  signUpEmail,
  signInEmail,
  signInGoogle,
  logOut,
  resetPassword,

  // Profile
  isUsernameAvailable,
  createUserProfile,
  getUserProfile,
  getProfileByUsername,
  updateUserProfile,
  searchUsers,

  // Scores
  submitGameResult,
  getUserScoreLog,
  getUserBestScore,

  // Leaderboard
  getCaseLeaderboard,
  getMyLeaderboardEntry,
  subscribeLeaderboard,

  // Cases
  getCaseMeta,
  recordCaseStart,

  // Visitors
  recordVisit,
  getVisitorCounts,

  // Badges
  BADGE_DEFINITIONS,
  evaluateBadges,
  awardBadges,

  // Direct access for advanced use
  auth,
  db,
};

export default MedSim;