/**
 * MedSim Nepal — Firebase Integration Module
 * ─────────────────────────────────────────────────────────────────────────
 * Handles: Auth, Firestore reads/writes, score submission, visitor counters,
 *          leaderboard, badge awards, username uniqueness checks.
 *
 * SETUP
 * ─────
 * 1. Firebase Console → Create project → "medsim-nepal"
 * 2. Authentication → Sign-in methods: Email/Password + Google
 * 3. Firestore Database → Production mode → Region: asia-south1
 * 4. Replace firebaseConfig below with your project config
 * 5. Deploy Firestore security rules (see bottom of file)
 * 6. Create composite indexes when Firestore prompts on first query run
 */

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

// ── YOUR FIREBASE CONFIG ─────────────────────────────────────────────────
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
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── Auth state ────────────────────────────────────────────────────────────
/**
 * Subscribe to auth state. cb is called immediately with current user or null.
 * Returns unsubscribe function.
 */
function onAuthChange(cb) {
  return onAuthStateChanged(auth, cb);
}

function currentUser() {
  return auth.currentUser;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTHENTICATION
// ═══════════════════════════════════════════════════════════════════════════

/** Sign up with email + password. Does NOT create Firestore profile. */
async function signUpEmail(email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return cred.user;
}

/** Sign in with email + password. */
async function signInEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

/** Sign in / sign up with Google popup. */
async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

/** Sign out current user. */
async function logOut() {
  await signOut(auth);
}

/** Send password reset email. */
async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

// ═══════════════════════════════════════════════════════════════════════════
// USER PROFILE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a username is available.
 * Returns true if available, throws if invalid format, returns false if taken.
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
 * Call this after first signup / first Google login when no profile exists yet.
 */
async function createUserProfile(uid, username, displayName, bio = '') {
  const usernameLower = username.toLowerCase();

  const available = await isUsernameAvailable(username);
  if (!available) throw new Error('Username is already taken. Please choose another.');

  const batch = writeBatch(db);

  batch.set(doc(db, 'users', uid), {
    uid,
    username,
    usernameLower,
    displayName:           displayName || username,
    bio,
    avatarUrl:             '',
    joinedAt:              serverTimestamp(),
    tags:                  [],
    badges:                [],
    totalCasesPlayed:      0,
    totalCasesSolved:      0,
    averageScore:          0,
    totalTimePlayed:       0,
  });

  // Reservation document — uniqueness enforcement
  batch.set(doc(db, 'usernames', usernameLower), { uid });

  await batch.commit();

  if (auth.currentUser) {
    await updateProfile(auth.currentUser, { displayName: displayName || username });
  }
}

/** Get a user's profile by their Firebase UID. Returns data or null. */
async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}

/**
 * Get a profile by username string.
 * Used by profile.html?u=username to render public profiles.
 * Returns profile data or null.
 */
async function getProfileByUsername(username) {
  const snap = await getDoc(doc(db, 'usernames', username.toLowerCase()));
  if (!snap.exists()) return null;
  const { uid } = snap.data();
  return await getUserProfile(uid);
}

/**
 * Update display name and bio (self-editable fields only).
 * Tags are admin-only (set directly in Firebase Console).
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

// ═══════════════════════════════════════════════════════════════════════════
// SCORE SUBMISSION (direct Firestore — no Cloud Functions)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Submit game results after a case ends.
 * Writes directly to Firestore scoreLog and updates leaderboard + user stats.
 *
 * @param {string} caseId
 * @param {object} gameState   - engine state at case end
 * @param {object} scoreResult - { score, grade, cured, penalty, cost, budget, timeElapsed }
 * @param {string} caseTitle   - display title for score log
 *
 * Returns: { grade, badgesAwarded, alreadyBest }
 */
async function submitGameResult(caseId, gameState, scoreResult, caseTitle = '') {
  const user = currentUser();
  if (!user) throw new Error('Must be signed in to submit scores.');

  const profile = await getUserProfile(user.uid);
  if (!profile) throw new Error('No profile found. Please complete account setup.');

  const {
    score, grade, cured, penalty,
    cost, budget, timeElapsed,
    diagnosisCorrect, outcome
  } = scoreResult;

  // 1. Write to scoreLog
  await addDoc(collection(db, 'scoreLog'), {
    uid:              user.uid,
    username:         profile.username,
    caseId,
    caseTitle:        caseTitle || caseId,
    score,
    grade,
    diagnosisCorrect: !!diagnosisCorrect,
    timeElapsed:      timeElapsed || 0,
    budgetUsed:       cost || 0,
    budgetTotal:      budget || 0,
    outcome:          outcome || (cured ? 'cured' : 'death'),
    cured:            !!cured,
    penaltyTotal:     penalty || 0,
    finalStage:       gameState.stage,
    testsOrdered:     (gameState.completedTests || []).map(t => t.testId || t),
    managementGiven:  (gameState.givenManagement || []).map(m => m.id || m),
    playedAt:         serverTimestamp(),
  });

  // 2. Update leaderboard — best score per user per case only
  const lbRef  = doc(db, 'leaderboard', caseId, 'entries', user.uid);
  const lbSnap = await getDoc(lbRef);
  let alreadyBest = false;

  if (!lbSnap.exists() || lbSnap.data().score < score) {
    await setDoc(lbRef, {
      uid:              user.uid,
      username:         profile.username,
      displayName:      profile.displayName || profile.username,
      score,
      grade,
      timeElapsed:      timeElapsed || 0,
      budgetUsed:       cost || 0,
      diagnosisCorrect: !!diagnosisCorrect,
      outcome:          outcome || (cured ? 'cured' : 'death'),
      playedAt:         serverTimestamp(),
    });
  } else {
    alreadyBest = true;
  }

  // 3. Update user aggregate stats
  const userRef  = doc(db, 'users', user.uid);
  const userSnap = await getDoc(userRef);
  const userData = userSnap.data() || {};
  const prevCount = userData.totalCasesPlayed || 0;
  const prevAvg   = userData.averageScore || 0;
  const newAvg    = ((prevAvg * prevCount) + score) / (prevCount + 1);

  await updateDoc(userRef, {
    totalCasesPlayed: increment(1),
    totalCasesSolved: cured ? increment(1) : increment(0),
    averageScore:     Math.round(newAvg * 10) / 10,
    totalTimePlayed:  increment(timeElapsed || 0),
  });

  // 4. Increment unique player count if first time on this case
  if (!lbSnap.exists()) {
    const caseRef = doc(db, 'cases', caseId);
    await updateDoc(caseRef, {
      totalUniquePlayers: increment(1),
    }).catch(async () => {
      await setDoc(caseRef, { caseId, totalUniquePlayers: 1, totalPlays: 0, averageScore: 0 }, { merge: true });
    });
  }

  // 5. Badge evaluation and award
  const updatedProfile = (await getDoc(userRef)).data();
  const badgesAwarded  = await _checkAndAwardBadges(user.uid, updatedProfile, scoreResult);

  return { grade, badgesAwarded, alreadyBest };
}

// ═══════════════════════════════════════════════════════════════════════════
// SCORE LOG & HISTORY
// ═══════════════════════════════════════════════════════════════════════════

/** Get play history for a user, newest first. */
async function getUserScoreLog(uid, limitCount = 30) {
  const q = query(
    collection(db, 'scoreLog'),
    where('uid', '==', uid),
    orderBy('playedAt', 'desc'),
    limit(limitCount)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Get user's best score for a specific case. */
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

/** Get top N entries for a case. Sorted by score desc, time asc. */
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

/** Get the current user's personal best leaderboard entry for a case. */
async function getMyLeaderboardEntry(caseId) {
  const user = currentUser();
  if (!user) return null;
  const snap = await getDoc(doc(db, 'leaderboard', caseId, 'entries', user.uid));
  return snap.exists() ? snap.data() : null;
}

/**
 * Real-time leaderboard subscription.
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
    cb(snap.docs.map((d, i) => ({ rank: i + 1, id: d.id, ...d.data() })));
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// CASE METADATA & COUNTERS
// ═══════════════════════════════════════════════════════════════════════════

/** Get case metadata (play counts, averages). Does not contain game logic JSON. */
async function getCaseMeta(caseId) {
  const snap = await getDoc(doc(db, 'cases', caseId));
  return snap.exists() ? snap.data() : null;
}

/**
 * Increment raw play counter when a user starts a case.
 * Call when "Begin Simulation" is pressed.
 */
async function recordCaseStart(caseId) {
  const ref = doc(db, 'cases', caseId);
  await updateDoc(ref, { totalPlays: increment(1) }).catch(async () => {
    await setDoc(ref, {
      caseId,
      totalPlays:         1,
      totalUniquePlayers: 0,
      averageScore:       0,
      averageTime:        0,
    }, { merge: true });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// VISITOR COUNTERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record one website visit per browser session.
 * Increments totalVisitors (all-time) and todayVisitors (daily reset).
 */
async function recordVisit() {
  if (sessionStorage.getItem('msn_visit_counted')) return;
  sessionStorage.setItem('msn_visit_counted', '1');

  const todayStr = new Date().toISOString().split('T')[0];
  const ref = doc(db, 'analytics', 'global');

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        tx.set(ref, { totalVisitors: 1, todayVisitors: 1, todayDate: todayStr });
      } else {
        const d = snap.data();
        if (d.todayDate === todayStr) {
          tx.update(ref, { totalVisitors: increment(1), todayVisitors: increment(1) });
        } else {
          tx.update(ref, { totalVisitors: increment(1), todayVisitors: 1, todayDate: todayStr });
        }
      }
    });
  } catch (e) {
    console.warn('Visitor counter failed silently:', e.message);
  }
}

/** Get current all-time and today visitor counts. */
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

const BADGE_DEFINITIONS = [
  {
    id:    'first_blood',
    name:  'First Diagnosis',
    icon:  '🩺',
    desc:  'Completed your first case.',
    check: (profile, _score) => (profile.totalCasesPlayed || 0) === 1,
  },
  {
    id:    'perfect_score',
    name:  'Textbook Clinician',
    icon:  '⭐',
    desc:  'Scored 95% or above on any case.',
    check: (_p, score) => score.score >= 95,
  },
  {
    id:    'speed_clinician',
    name:  'Speed Clinician',
    icon:  '⚡',
    desc:  'Completed a case in under 10 minutes.',
    check: (_p, score) => (score.timeElapsed || 0) < 600 && score.cured,
  },
  {
    id:    'budget_master',
    name:  'Budget Master',
    icon:  '💰',
    desc:  'Cured the patient spending under 40% of budget.',
    check: (_p, score) => score.cured && score.budget > 0 && (score.cost / score.budget) < 0.4,
  },
  {
    id:    'no_blunders',
    name:  'First, Do No Harm',
    icon:  '🛡️',
    desc:  'Completed a case with zero blunder choices.',
    check: (_p, score) => score.cured && score.penalty === 0,
  },
  {
    id:    'diagnostician',
    name:  'Senior Diagnostician',
    icon:  '🔬',
    desc:  'Correctly diagnosed 10 different cases.',
    check: (profile, _score) => (profile.totalCasesSolved || 0) >= 10,
  },
  {
    id:    'veteran',
    name:  'Veteran',
    icon:  '🎖️',
    desc:  'Played 25 or more cases.',
    check: (profile, _score) => (profile.totalCasesPlayed || 0) >= 25,
  },
  {
    id:    'resident_grade',
    name:  'Resident Level',
    icon:  '📋',
    desc:  'Averaged 75+ score over at least 5 cases.',
    check: (profile, _score) => (profile.averageScore || 0) >= 75 && (profile.totalCasesPlayed || 0) >= 5,
  },
];

/** Internal: check and award any newly earned badges after a game result. */
async function _checkAndAwardBadges(uid, updatedProfile, scoreResult) {
  const already = new Set(updatedProfile.badges || []);
  const toAward = BADGE_DEFINITIONS
    .filter(b => !already.has(b.id) && b.check(updatedProfile, scoreResult))
    .map(b => b.id);

  if (toAward.length) {
    await updateDoc(doc(db, 'users', uid), { badges: arrayUnion(...toAward) });
  }

  return toAward.map(id => BADGE_DEFINITIONS.find(b => b.id === id)).filter(Boolean);
}

// ═══════════════════════════════════════════════════════════════════════════
// FIRESTORE SECURITY RULES
// Deploy via: firebase deploy --only firestore:rules
// ═══════════════════════════════════════════════════════════════════════════
/*
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /users/{uid} {
      allow read: if true;
      allow create: if request.auth.uid == uid
                    && !('tags' in request.resource.data)
                    && !('badges' in request.resource.data);
      allow update: if request.auth.uid == uid
                    && !('tags' in request.resource.data);
    }

    match /usernames/{username} {
      allow read: if true;
      allow write: if request.auth != null
                   && request.resource.data.uid == request.auth.uid;
    }

    match /scoreLog/{docId} {
      allow read: if request.auth != null && resource.data.uid == request.auth.uid;
      allow create: if request.auth != null && request.resource.data.uid == request.auth.uid;
      allow update: if false;
      allow delete: if false;
    }

    match /leaderboard/{caseId}/entries/{uid} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == uid;
    }

    match /cases/{caseId} {
      allow read: if true;
      allow write: if request.auth != null;
    }

    match /analytics/{docId} {
      allow read: if true;
      allow write: if true;
    }
  }
}
*/

// ═══════════════════════════════════════════════════════════════════════════
// COMPOSITE INDEXES NEEDED (Firestore Console → Indexes → Composite)
// ═══════════════════════════════════════════════════════════════════════════
/*
  scoreLog:
    uid ASC, playedAt DESC
    uid ASC, caseId ASC, score DESC

  leaderboard/{caseId}/entries (subcollection):
    score DESC, timeElapsed ASC
*/

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

  // Direct access
  auth,
  db,
};

export default MedSim;