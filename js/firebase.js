/**
 * Clinical Simulation — Firebase Integration Module
 * ─────────────────────────────────────────────────────────────────────────
 * Handles: Auth, Firestore reads/writes, score submission, visitor counters,
 *          leaderboard, badge awards, username uniqueness checks.
 *
 * No Cloud Functions — everything runs client-side (free Spark tier compatible).
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

// ── Firebase config ──────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyByHm5CvMK2GLcciEFjwfFzkcS23eduko0",
  authDomain:        "clinic-case-os.firebaseapp.com",
  projectId:         "clinic-case-os",
  storageBucket:     "clinic-case-os.firebasestorage.app",
  messagingSenderId: "588710608362",
  appId:             "1:588710608362:web:7f49b21be5d55bd7cfc693",
  measurementId:     "G-HS0MXGP5SB"
};

// ── Init ─────────────────────────────────────────────────────────────────────
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);


// ═══════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════

function onAuthChange(cb) {
  return onAuthStateChanged(auth, cb);
}

function currentUser() {
  return auth.currentUser;
}

async function signUpEmail(email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return cred.user;
}

async function signInEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

async function logOut() {
  await signOut(auth);
}

async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}


// ═══════════════════════════════════════════════════════════════════════════
// USER PROFILE
// ═══════════════════════════════════════════════════════════════════════════

async function isUsernameAvailable(username) {
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    throw new Error('Username must be 3–20 characters: letters, numbers, underscores only.');
  }
  const snap = await getDoc(doc(db, 'usernames', username.toLowerCase()));
  return !snap.exists();
}

async function createUserProfile(uid, username, displayName, bio = '') {
  const usernameLower = username.toLowerCase();

  const available = await isUsernameAvailable(username);
  if (!available) throw new Error('Username is already taken.');

  const batch = writeBatch(db);

  batch.set(doc(db, 'users', uid), {
    uid,
    username,
    usernameLower,
    displayName:          displayName || username,
    bio,
    avatarUrl:            '',
    joinedAt:             serverTimestamp(),
    tags:                 [],
    badges:               [],
    totalCasesPlayed:     0,
    totalCasesSolved:     0,
    averageScore:         0,
    totalTimePlayed:      0,
    bestScores:           {},
  });

  batch.set(doc(db, 'usernames', usernameLower), { uid });

  await batch.commit();

  if (auth.currentUser) {
    await updateProfile(auth.currentUser, { displayName: displayName || username });
  }
}

async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}

async function getProfileByUsername(username) {
  const usernameLower = username.toLowerCase();
  const usernameSnap  = await getDoc(doc(db, 'usernames', usernameLower));
  if (!usernameSnap.exists()) return null;
  const { uid } = usernameSnap.data();
  return await getUserProfile(uid);
}

async function updateUserProfile(uid, { displayName, bio }) {
  const updates = {};
  if (displayName !== undefined) updates.displayName = displayName;
  if (bio         !== undefined) updates.bio = bio;
  await updateDoc(doc(db, 'users', uid), updates);
  if (auth.currentUser && displayName) {
    await updateProfile(auth.currentUser, { displayName });
  }
}

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
// SCORE SUBMISSION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Submit a completed (cured) case result.
 * Only call this when the patient is cured.
 *
 * @param {string} caseId
 * @param {object} gameState   — engine.getState()
 * @param {object} scoreResult — engine.calculateScore()
 * @param {Array}  eventLog    — engine.log
 *
 * Returns: { written, alreadyBest, newBest }
 */
async function submitGameResult(caseId, gameState, scoreResult, eventLog) {
  const user = currentUser();
  if (!user) throw new Error('Must be logged in to submit scores.');

  const uid         = user.uid;
  const profile     = await getUserProfile(uid);
  const username    = profile?.username || user.displayName || uid;
  const newScore    = scoreResult.score;
  const timeElapsed = Math.round(gameState.time * 3600);

  // ── Fix: older user docs may not have bestScores field at all.
  // Firestore dot-notation updates (bestScores.caseId) silently fail
  // if the parent field doesn't exist. Patch it first.
  if (!profile?.bestScores) {
    await setDoc(doc(db, 'users', uid), { bestScores: {} }, { merge: true });
  }

  // ── 1. Check existing leaderboard entry ──────────────────────────────────
  const lbRef  = doc(db, 'leaderboard', caseId, 'entries', uid);
  const lbSnap = await getDoc(lbRef);
  const existingBest      = lbSnap.exists() ? lbSnap.data().score : null;
  const isFirstTimePlayer = existingBest === null;
  const alreadyBest       = existingBest !== null && existingBest >= newScore;

  if (alreadyBest) {
    await _writeScoreLog(uid, username, caseId, gameState, scoreResult, timeElapsed, false);
    await _updateUserStats(uid, newScore, gameState);
    await _updateCaseStats(caseId, newScore, timeElapsed, false);
    return { written: false, alreadyBest: true, newBest: existingBest };
  }

  // ── 2. New best — batch write ─────────────────────────────────────────────
  const batch  = writeBatch(db);
  const logRef = doc(collection(db, 'scoreLog'));

  batch.set(logRef, {
    uid,
    username,
    caseId,
    score:             newScore,
    grade:             scoreResult.grade,
    diagnosisCorrect:  gameState.diagnosisCorrect,
    selectedDiagnosis: gameState.selectedDiagnosis,
    timeElapsed,
    budgetUsed:        gameState.cost,
    budgetTotal:       gameState.budget,
    outcome:           gameState.outcome,
    finalStage:        gameState.stage,
    cured:             gameState.cured,
    penaltyTotal:      gameState.penalty,
    testsOrdered:      gameState.completedTests.map(t => t.testId),
    managementGiven:   gameState.givenManagement.map(m => m.id),
    isPersonalBest:    true,
    playedAt:          serverTimestamp(),
  });

  batch.set(lbRef, {
    uid,
    username,
    score:             newScore,
    grade:             scoreResult.grade,
    timeElapsed,
    budgetUsed:        gameState.cost,
    diagnosisCorrect:  gameState.diagnosisCorrect,
    outcome:           gameState.outcome,
    playedAt:          serverTimestamp(),
  });

  batch.update(doc(db, 'users', uid), {
    [`bestScores.${caseId}`]: newScore,
  });

  await batch.commit();

  await _updateUserStats(uid, newScore, gameState);
  await _updateCaseStats(caseId, newScore, timeElapsed, isFirstTimePlayer);

  return { written: true, alreadyBest: false, newBest: newScore };
}

async function _writeScoreLog(uid, username, caseId, gameState, scoreResult, timeElapsed, isPersonalBest) {
  try {
    await addDoc(collection(db, 'scoreLog'), {
      uid,
      username,
      caseId,
      score:             scoreResult.score,
      grade:             scoreResult.grade,
      diagnosisCorrect:  gameState.diagnosisCorrect,
      selectedDiagnosis: gameState.selectedDiagnosis,
      timeElapsed,
      budgetUsed:        gameState.cost,
      budgetTotal:       gameState.budget,
      outcome:           gameState.outcome,
      finalStage:        gameState.stage,
      cured:             gameState.cured,
      penaltyTotal:      gameState.penalty,
      testsOrdered:      gameState.completedTests.map(t => t.testId),
      managementGiven:   gameState.givenManagement.map(m => m.id),
      isPersonalBest,
      playedAt:          serverTimestamp(),
    });
  } catch (_) {}
}

async function _updateUserStats(uid, newScore, gameState) {
  try {
    const userRef  = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    const data     = userSnap.exists() ? userSnap.data() : {};

    const prevCount = data.totalCasesPlayed || 0;
    const prevAvg   = data.averageScore     || 0;
    const newAvg    = prevCount === 0
      ? newScore
      : parseFloat(((prevAvg * prevCount + newScore) / (prevCount + 1)).toFixed(1));

    await updateDoc(userRef, {
      totalCasesPlayed:  increment(1),
      totalCasesSolved:  increment(gameState.cured ? 1 : 0),
      averageScore:      newAvg,
      totalTimePlayed:   increment(Math.round(gameState.time * 3600)),
    });
  } catch (_) {}
}

async function _updateCaseStats(caseId, newScore, timeElapsed, isFirstTimePlayer) {
  try {
    const ref  = doc(db, 'cases', caseId);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      await setDoc(ref, {
        caseId,
        totalPlays:         1,
        totalCompletions:   1,
        totalUniquePlayers: isFirstTimePlayer ? 1 : 0,
        averageScore:       newScore,
        averageTime:        timeElapsed,
      });
      return;
    }

    const d         = snap.data();
    const prevCompl = d.totalCompletions || 0;

    const newAvgScore = prevCompl === 0
      ? newScore
      : parseFloat((((d.averageScore || 0) * prevCompl + newScore) / (prevCompl + 1)).toFixed(1));

    const newAvgTime = prevCompl === 0
      ? timeElapsed
      : Math.round(((d.averageTime || 0) * prevCompl + timeElapsed) / (prevCompl + 1));

    const updates = {
      totalCompletions: increment(1),
      averageScore:     newAvgScore,
      averageTime:      newAvgTime,
    };
    if (isFirstTimePlayer) updates.totalUniquePlayers = increment(1);

    await updateDoc(ref, updates);
  } catch (_) {}
}


// ═══════════════════════════════════════════════════════════════════════════
// SCORE LOG & HISTORY
// ═══════════════════════════════════════════════════════════════════════════

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

async function getUserClearedCases(uid) {
  const profile = await getUserProfile(uid);
  if (!profile) return null;
  return {
    bestScores:      profile.bestScores       || {},
    totalPlayed:     profile.totalCasesPlayed || 0,
    totalSolved:     profile.totalCasesSolved || 0,
    averageScore:    profile.averageScore      || 0,
    totalTimePlayed: profile.totalTimePlayed   || 0,
    badges:          profile.badges            || [],
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// LEADERBOARD
// ═══════════════════════════════════════════════════════════════════════════

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

async function getMyLeaderboardEntry(caseId) {
  const user = currentUser();
  if (!user) return null;
  const snap = await getDoc(doc(db, 'leaderboard', caseId, 'entries', user.uid));
  return snap.exists() ? snap.data() : null;
}

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

async function getCaseMeta(caseId) {
  const snap = await getDoc(doc(db, 'cases', caseId));
  return snap.exists() ? snap.data() : null;
}

/**
 * Increment the case play counter when a user starts a case.
 * Works for guests too — no auth required.
 * Uses setDoc with merge:true so it works even if the doc doesn't exist yet.
 */
async function recordCaseStart(caseId) {
  try {
    const ref = doc(db, 'cases', caseId);
    // Try updateDoc first; if doc doesn't exist, create it
    try {
      await updateDoc(ref, { totalPlays: increment(1) });
    } catch (e) {
      // Document doesn't exist yet — create it
      await setDoc(ref, { caseId, totalPlays: 1 }, { merge: true });
    }
  } catch (_) {}
}


// ═══════════════════════════════════════════════════════════════════════════
// VISITOR COUNTERS
// ═══════════════════════════════════════════════════════════════════════════

async function recordVisit() {
  if (sessionStorage.getItem('msn_visit_counted')) return;
  sessionStorage.setItem('msn_visit_counted', '1');

  const todayStr = new Date().toISOString().split('T')[0];
  const ref      = doc(db, 'analytics', 'global');

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
    console.warn('Visitor counter failed:', e.message);
  }
}

async function getVisitorCounts() {
  const snap = await getDoc(doc(db, 'analytics', 'global'));
  if (!snap.exists()) return { totalVisitors: 0, todayVisitors: 0 };
  const d        = snap.data();
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
    id:          'first_blood',
    name:        'First Diagnosis',
    description: 'Completed your first case.',
    icon:        '🩺',
    check:       (profile, _score) => (profile.totalCasesPlayed || 0) === 0,
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
    description: 'Completed a case with zero penalty points.',
    icon:        '🛡️',
    check:       (_p, score) => score.cured && score.penalty === 0,
  },
  {
    id:          'diagnostician',
    name:        'Senior Diagnostician',
    description: 'Correctly diagnosed 10 different cases.',
    icon:        '🔬',
    check:       (profile, _score) => (profile.totalCasesSolved || 0) >= 10,
  },
  {
    id:          'veteran',
    name:        'Veteran',
    description: 'Played 25 or more cases.',
    icon:        '🎖️',
    check:       (profile, _score) => (profile.totalCasesPlayed || 0) >= 25,
  },
  {
    id:          'resident_grade',
    name:        'Resident Level',
    description: 'Achieved an average score of 75+ across 5 cases.',
    icon:        '📋',
    check:       (profile, _score) => (profile.averageScore || 0) >= 75 && (profile.totalCasesPlayed || 0) >= 5,
  },
];

function evaluateBadges(userProfile, scoreResult) {
  const already = new Set(userProfile.badges || []);
  return BADGE_DEFINITIONS
    .filter(b => !already.has(b.id) && b.check(userProfile, scoreResult))
    .map(b => b.id);
}

async function awardBadges(uid, badgeIds) {
  if (!badgeIds.length) return [];
  await updateDoc(doc(db, 'users', uid), {
    badges: arrayUnion(...badgeIds),
  });
  return badgeIds.map(id => BADGE_DEFINITIONS.find(b => b.id === id)).filter(Boolean);
}


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

  // Scores & history
  submitGameResult,
  getUserScoreLog,
  getUserBestScore,
  getUserClearedCases,

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

// ── CRITICAL FIX: expose as a global so non-module scripts can use MedSim ──
// cases.html, index.html and app.js check `typeof MedSim !== 'undefined'`
// but since this file is an ES module it never sets window.MedSim automatically.
window.MedSim = MedSim;