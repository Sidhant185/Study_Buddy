import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  addDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  increment,
} from "firebase/firestore";
import { db } from "../firebase/config.js";

const COLLECTIONS = {
  subjects: "subjects",
  contests: "contests",
  students: "students",
  scores: "studentSubjectScores",
  // New collections for Java contest workflow
  questions: "questions", // Subcollection under contests
  submissions: "submissions", // Subcollection under contests
  evaluations: "evaluations", // Subcollection under submissions
  topicAnalytics: "topicAnalytics", // Per student per subject
  practiceTasks: "practiceTasks", // Per student
  impTopics: "impTopics", // Global topic frequency tracking
};

const withId = (snap) => {
  if (!snap) return null;
  return { id: snap.id, ...snap.data() };
};

const mapCollection = (snapshot) =>
  snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));

/**
 * Utility function to consistently parse testCases from various formats
 * @param {string|Array} testCases - Test cases as string (JSON) or array
 * @returns {Array} Parsed test cases array
 */
export const parseTestCases = (testCases) => {
  if (!testCases) {
    console.log('⚠️ parseTestCases: No testCases provided, returning empty array');
    return [];
  }
  
  if (Array.isArray(testCases)) {
    console.log(`✅ parseTestCases: Already array with ${testCases.length} test cases`);
    return testCases;
  }
  
  if (typeof testCases === "string") {
    try {
      const parsed = JSON.parse(testCases);
      if (Array.isArray(parsed)) {
        console.log(`✅ parseTestCases: Parsed JSON string to array with ${parsed.length} test cases`);
        return parsed;
      } else {
        console.warn('⚠️ parseTestCases: JSON parsed but result is not an array:', parsed);
        return [];
      }
    } catch (e) {
      console.warn('⚠️ parseTestCases: JSON parse failed, trying comma-separated format:', e.message);
      // Try comma-separated format: input1:output1, input2:output2
      try {
        const pairs = testCases.split(",").map((pair) => {
          const [input, output] = pair.split(":").map((s) => s.trim());
          return { 
            input: input || "", 
            expectedOutput: output || "",
            inputValue: input || "", // Alternative field name
            output: output || "" // Alternative field name
          };
        });
        const filtered = pairs.filter((tc) => tc.input || tc.expectedOutput);
        console.log(`✅ parseTestCases: Parsed comma-separated format to ${filtered.length} test cases`);
        return filtered;
      } catch (e2) {
        console.error('❌ parseTestCases: All parsing failed:', e2.message);
        return [];
      }
    }
  }
  
  console.warn('⚠️ parseTestCases: Unknown testCases type:', typeof testCases);
  return [];
};

export async function listSubjects() {
  const snapshot = await getDocs(
    query(collection(db, COLLECTIONS.subjects), orderBy("order", "asc"))
  );
  return mapCollection(snapshot);
}

export async function createSubject(subject) {
  const subjectPayload = {
    name: subject.name,
    description: subject.description || "",
    order: subject.order ?? 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  return addDoc(collection(db, COLLECTIONS.subjects), subjectPayload);
}

export async function listContests(subjectId) {
  if (!subjectId || typeof subjectId !== 'string') {
    console.error('listContests: Invalid subjectId:', subjectId);
    throw new Error(`Invalid subjectId: ${subjectId}. Must be a non-empty string.`);
  }
  
  try {
    const subjectRef = doc(db, COLLECTIONS.subjects, subjectId);
    const contestsRef = collection(subjectRef, COLLECTIONS.contests);
    const snapshot = await getDocs(query(contestsRef, orderBy("scheduledAt", "desc")));
    console.log(`✅ listContests: Found ${snapshot.docs.length} contests for subject ${subjectId}`);
    return mapCollection(snapshot);
  } catch (error) {
    console.error('listContests error:', error);
    throw new Error(`Failed to list contests for subject ${subjectId}: ${error.message}`);
  }
}

export async function createContest(subjectId, contest) {
  if (!subjectId || typeof subjectId !== 'string') {
    console.error('createContest: Invalid subjectId:', subjectId);
    throw new Error(`Invalid subjectId: ${subjectId}. Must be a non-empty string.`);
  }
  if (!contest || typeof contest !== 'object') {
    console.error('createContest: Invalid contest object:', contest);
    throw new Error('Invalid contest object. Must be a valid contest object.');
  }
  if (!contest.title || typeof contest.title !== 'string') {
    console.error('createContest: Invalid contest title:', contest.title);
    throw new Error('Contest title is required and must be a string.');
  }
  
  console.log(`📝 createContest: Creating contest "${contest.title}" for subject ${subjectId}`);
  
  try {
    const subjectRef = doc(db, COLLECTIONS.subjects, subjectId);
    const contestsRef = collection(subjectRef, COLLECTIONS.contests);
    const payload = {
      title: contest.title,
      maxScore: Number(contest.maxScore ?? 0),
      scheduledAt: contest.scheduledAt ? new Date(contest.scheduledAt) : new Date(),
      // New fields for Java contests
      subjectType: contest.subjectType || "general", // "java", "maths", "web", "general"
      description: contest.description || "",
      difficulty: contest.difficulty || "medium", // "easy", "medium", "hard"
      topics: contest.topics || [], // Array of topic tags
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const contestRef = await addDoc(contestsRef, payload);
    
    // If questions are provided, create them
    if (contest.questions && Array.isArray(contest.questions) && contest.questions.length > 0) {
      const questionsRef = collection(contestRef, COLLECTIONS.questions);
      const questionPromises = contest.questions.map((q, index) =>
        addDoc(questionsRef, {
          questionNumber: q.questionNumber || index + 1,
          title: q.title || `Question ${index + 1}`,
          description: q.description || "",
          expectedSolution: q.expectedSolution || "", // Reference code
          testCases: parseTestCases(q.testCases), // Array of {input, expectedOutput}
          maxScore: Number(q.maxScore ?? 0),
          topics: q.topics || [],
          difficulty: q.difficulty || contest.difficulty || "medium",
          createdAt: serverTimestamp(),
        })
      );
      await Promise.all(questionPromises);
    }
    
    console.log(`✅ createContest: Contest "${contest.title}" created with ID ${contestRef.id}`);
    return contestRef;
  } catch (error) {
    console.error('createContest error:', error);
    throw new Error(`Failed to create contest: ${error.message}`);
  }
}

export async function listStudents() {
  const snapshot = await getDocs(
    query(collection(db, COLLECTIONS.students), orderBy("createdAt", "desc"))
  );
  return mapCollection(snapshot);
}

export async function createStudent(student) {
  const payload = {
    name: student.name,
    email: student.email.toLowerCase(),
    vedamId: student.vedamId || "",
    track: student.track || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  return addDoc(collection(db, COLLECTIONS.students), payload);
}

export async function findStudentByEmail(email) {
  const snapshot = await getDocs(
    query(
      collection(db, COLLECTIONS.students),
      where("email", "==", email.toLowerCase())
    )
  );
  if (snapshot.empty) return null;
  return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export function calculateVedamSubjectScore(contestEntries, mockScore) {
  const sanitizedEntries = contestEntries
    .filter(
      (entry) =>
        entry &&
        typeof entry.rawScore === "number" &&
        typeof entry.maxScore === "number" &&
        entry.maxScore > 0
    )
    .map((entry) => {
      const normalized = clamp((entry.rawScore / entry.maxScore) * 50, 0, 50);
      return {
        contestId: entry.contestId,
        contestTitle: entry.contestTitle || "",
        rawScore: Number(entry.rawScore.toFixed(2)),
        maxScore: Number(entry.maxScore.toFixed(2)),
        normalizedScore: Number(normalized.toFixed(2)),
      };
    });

  const contestNormalizedTotal = sanitizedEntries.reduce(
    (sum, entry) => sum + entry.normalizedScore,
    0
  );
  const contestCount = sanitizedEntries.length;
  const contestMaxPossible = contestCount * 50 || 1;
  const contestScaled40 = clamp(
    (contestNormalizedTotal / contestMaxPossible) * 40,
    0,
    40
  );
  const sanitizedMock = clamp(Number(mockScore ?? 0), 0, 60);
  const total = clamp(contestScaled40 + sanitizedMock, 0, 100);

  return {
    entries: sanitizedEntries,
    contestNormalizedTotal: Number(contestNormalizedTotal.toFixed(2)),
    contestMaxPossible,
    contestScaled40: Number(contestScaled40.toFixed(2)),
    mockScore: Number(sanitizedMock.toFixed(2)),
    total: Number(total.toFixed(2)),
  };
}

export async function upsertStudentSubjectScore({
  studentId,
  subjectId,
  contestEntries,
  mockScore,
}) {
  if (!studentId || !subjectId) {
    throw new Error("studentId and subjectId are required");
  }

  const { entries, contestNormalizedTotal, contestMaxPossible, contestScaled40, mockScore: mockScoreSanitized, total } =
    calculateVedamSubjectScore(contestEntries, mockScore);

  const scoreDocId = `${studentId}_${subjectId}`;
  const scoreRef = doc(db, COLLECTIONS.scores, scoreDocId);

  await setDoc(
    scoreRef,
    {
      studentId,
      subjectId,
      contests: entries,
      contestNormalizedTotal,
      contestMaxPossible,
      contestScaled40,
      mockScore: mockScoreSanitized,
      total,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  const snapshot = await getDoc(scoreRef);
  return withId(snapshot);
}

export async function listStudentSubjectScores(studentId) {
  const snapshot = await getDocs(
    query(
      collection(db, COLLECTIONS.scores),
      where("studentId", "==", studentId)
    )
  );
  return mapCollection(snapshot);
}

export async function getStudentSubjectScore(studentId, subjectId) {
  const scoreRef = doc(db, COLLECTIONS.scores, `${studentId}_${subjectId}`);
  const snap = await getDoc(scoreRef);
  if (!snap.exists()) return null;
  return withId(snap);
}

// ===== NEW FUNCTIONS FOR JAVA CONTEST WORKFLOW =====

/**
 * Get all questions for a contest
 * Note: contests are subcollections of subjects, so we need subjectId
 */
export async function listContestQuestions(subjectId, contestId) {
  if (!subjectId || !contestId) {
    throw new Error(`Invalid parameters: subjectId=${subjectId}, contestId=${contestId}`);
  }
  
  const subjectRef = doc(db, COLLECTIONS.subjects, subjectId);
  const contestRef = doc(subjectRef, COLLECTIONS.contests, contestId);
  const questionsRef = collection(contestRef, COLLECTIONS.questions);
  const snapshot = await getDocs(query(questionsRef, orderBy("questionNumber", "asc")));
  return mapCollection(snapshot);
}

/**
 * Get a specific question
 */
export async function getContestQuestion(subjectId, contestId, questionId) {
  const subjectRef = doc(db, COLLECTIONS.subjects, subjectId);
  const contestRef = doc(subjectRef, COLLECTIONS.contests, contestId);
  const questionRef = doc(contestRef, COLLECTIONS.questions, questionId);
  const snap = await getDoc(questionRef);
  if (!snap.exists()) return null;
  return withId(snap);
}

/**
 * Create a student submission for a contest
 */
export async function createSubmission({ subjectId, contestId, studentId, questionId, code, language = "java" }) {
  // Comprehensive parameter validation
  if (!subjectId || typeof subjectId !== 'string') {
    console.error('createSubmission: Invalid subjectId:', subjectId);
    throw new Error(`Invalid subjectId: ${subjectId}. Must be a non-empty string.`);
  }
  if (!contestId || typeof contestId !== 'string') {
    console.error('createSubmission: Invalid contestId:', contestId);
    throw new Error(`Invalid contestId: ${contestId}. Must be a non-empty string.`);
  }
  if (!studentId || typeof studentId !== 'string') {
    console.error('createSubmission: Invalid studentId:', studentId);
    throw new Error(`Invalid studentId: ${studentId}. Must be a non-empty string.`);
  }
  if (!questionId || typeof questionId !== 'string') {
    console.error('createSubmission: Invalid questionId:', questionId);
    throw new Error(`Invalid questionId: ${questionId}. Must be a non-empty string.`);
  }
  if (!code || typeof code !== 'string' || !code.trim()) {
    console.error('createSubmission: Invalid code:', code);
    throw new Error('Code is required and must be a non-empty string.');
  }
  
  console.log(`📤 createSubmission: Creating submission for student ${studentId}, contest ${contestId}, question ${questionId}`);
  
  try {
    const subjectRef = doc(db, COLLECTIONS.subjects, subjectId);
    const contestRef = doc(subjectRef, COLLECTIONS.contests, contestId);
    const submissionsRef = collection(contestRef, COLLECTIONS.submissions);
    const payload = {
      studentId,
      questionId,
      code: code.trim(),
      language,
      status: "pending", // "pending", "submitted", "evaluating", "evaluated", "error"
      submittedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    };
    const submissionRef = await addDoc(submissionsRef, payload);
    console.log(`✅ createSubmission: Submission created with ID ${submissionRef.id}`);
    return submissionRef;
  } catch (error) {
    console.error('createSubmission error:', error);
    throw new Error(`Failed to create submission: ${error.message}`);
  }
}

/**
 * Get all submissions for a contest (optionally filtered by student)
 */
export async function listContestSubmissions(subjectId, contestId, studentId = null) {
  if (!subjectId || typeof subjectId !== 'string') {
    console.error('listContestSubmissions: Invalid subjectId:', subjectId);
    throw new Error(`Invalid subjectId: ${subjectId}. Must be a non-empty string.`);
  }
  if (!contestId || typeof contestId !== 'string') {
    console.error('listContestSubmissions: Invalid contestId:', contestId);
    throw new Error(`Invalid contestId: ${contestId}. Must be a non-empty string.`);
  }
  if (studentId && typeof studentId !== 'string') {
    console.error('listContestSubmissions: Invalid studentId:', studentId);
    throw new Error(`Invalid studentId: ${studentId}. Must be a string or null.`);
  }
  
  console.log(`📋 listContestSubmissions: Getting submissions for contest ${contestId}${studentId ? `, student ${studentId}` : ''}`);
  
  try {
    const subjectRef = doc(db, COLLECTIONS.subjects, subjectId);
    const contestRef = doc(subjectRef, COLLECTIONS.contests, contestId);
    const submissionsRef = collection(contestRef, COLLECTIONS.submissions);
  let q = query(submissionsRef, orderBy("submittedAt", "desc"));
  if (studentId) {
    q = query(submissionsRef, where("studentId", "==", studentId), orderBy("submittedAt", "desc"));
  }
    const snapshot = await getDocs(q);
    console.log(`✅ listContestSubmissions: Found ${snapshot.docs.length} submissions for contest ${contestId}${studentId ? `, student ${studentId}` : ''}`);
    return mapCollection(snapshot);
  } catch (error) {
    console.error('listContestSubmissions error:', error);
    throw new Error(`Failed to list submissions: ${error.message}`);
  }
}

/**
 * Get a specific submission
 */
export async function getSubmission(subjectId, contestId, submissionId) {
  if (!subjectId || typeof subjectId !== 'string') {
    console.error('getSubmission: Invalid subjectId:', subjectId);
    throw new Error(`Invalid subjectId: ${subjectId}. Must be a non-empty string.`);
  }
  if (!contestId || typeof contestId !== 'string') {
    console.error('getSubmission: Invalid contestId:', contestId);
    throw new Error(`Invalid contestId: ${contestId}. Must be a non-empty string.`);
  }
  if (!submissionId || typeof submissionId !== 'string') {
    console.error('getSubmission: Invalid submissionId:', submissionId);
    throw new Error(`Invalid submissionId: ${submissionId}. Must be a non-empty string.`);
  }
  
  console.log(`🔍 getSubmission: Getting submission ${submissionId} from contest ${contestId}`);
  
  try {
    const subjectRef = doc(db, COLLECTIONS.subjects, subjectId);
    const contestRef = doc(subjectRef, COLLECTIONS.contests, contestId);
    const submissionRef = doc(contestRef, COLLECTIONS.submissions, submissionId);
    const snap = await getDoc(submissionRef);
    if (!snap.exists()) {
      console.warn(`⚠️ getSubmission: Submission ${submissionId} not found`);
      return null;
    }
    console.log(`✅ getSubmission: Found submission ${submissionId}`);
    return withId(snap);
  } catch (error) {
    console.error('getSubmission error:', error);
    throw new Error(`Failed to get submission ${submissionId}: ${error.message}`);
  }
}

/**
 * Update submission status
 */
export async function updateSubmissionStatus(subjectId, contestId, submissionId, status, metadata = {}) {
  const subjectRef = doc(db, COLLECTIONS.subjects, subjectId);
  const contestRef = doc(subjectRef, COLLECTIONS.contests, contestId);
  const submissionRef = doc(contestRef, COLLECTIONS.submissions, submissionId);
  await setDoc(
    submissionRef,
    {
      status,
      ...metadata,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Create an AI evaluation report for a submission
 */
export async function createEvaluation({ subjectId, contestId, submissionId, report }) {
  const subjectRef = doc(db, COLLECTIONS.subjects, subjectId);
  const contestRef = doc(subjectRef, COLLECTIONS.contests, contestId);
  const submissionRef = doc(contestRef, COLLECTIONS.submissions, submissionId);
  const evaluationsRef = collection(submissionRef, COLLECTIONS.evaluations);
  const payload = {
    strengths: report.strengths || [],
    weaknesses: report.weaknesses || [],
    suggestions: report.suggestions || [],
    topicScores: report.topicScores || {}, // { "topicName": score 0-100 }
    overallScore: report.overallScore || 0,
    detailedAnalysis: report.detailedAnalysis || "",
    practiceQuestions: report.practiceQuestions || [], // Generated practice tasks
    evaluatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  };
  return addDoc(evaluationsRef, payload);
}

/**
 * Get evaluation for a submission
 */
export async function getSubmissionEvaluation(subjectId, contestId, submissionId) {
  const subjectRef = doc(db, COLLECTIONS.subjects, subjectId);
  const contestRef = doc(subjectRef, COLLECTIONS.contests, contestId);
  const submissionRef = doc(contestRef, COLLECTIONS.submissions, submissionId);
  const evaluationsRef = collection(submissionRef, COLLECTIONS.evaluations);
  const snapshot = await getDocs(query(evaluationsRef, orderBy("evaluatedAt", "desc")));
  if (snapshot.empty) return null;
  return withId(snapshot.docs[0]);
}

/**
 * Upsert topic analytics for a student-subject pair
 */
export async function upsertTopicAnalytics({ studentId, subjectId, topicUpdates }) {
  // topicUpdates: { "topicName": { score: 0-100, strength: "weak"|"medium"|"strong", lastUpdated: timestamp } }
  const analyticsId = `${studentId}_${subjectId}`;
  const analyticsRef = doc(db, COLLECTIONS.topicAnalytics, analyticsId);
  const existing = await getDoc(analyticsRef);
  
  const existingTopics = existing.exists() ? existing.data().topics || {} : {};
  
  // Merge topic updates, avoiding duplicates and updating scores intelligently
  const mergedTopics = { ...existingTopics };
  for (const [topicName, update] of Object.entries(topicUpdates)) {
    if (!mergedTopics[topicName] || update.score !== undefined) {
      mergedTopics[topicName] = {
        score: update.score ?? mergedTopics[topicName]?.score ?? 50,
        strength: update.strength ?? mergedTopics[topicName]?.strength ?? "medium",
        lastUpdated: serverTimestamp(),
        contestCount: (mergedTopics[topicName]?.contestCount || 0) + 1,
      };
    }
  }
  
  await setDoc(
    analyticsRef,
    {
      studentId,
      subjectId,
      topics: mergedTopics,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  
  return getDoc(analyticsRef).then(withId);
}

/**
 * Get topic analytics for a student-subject pair
 */
export async function getTopicAnalytics(studentId, subjectId) {
  const analyticsId = `${studentId}_${subjectId}`;
  const analyticsRef = doc(db, COLLECTIONS.topicAnalytics, analyticsId);
  const snap = await getDoc(analyticsRef);
  if (!snap.exists()) return null;
  return withId(snap);
}

/**
 * Get all topic analytics for a student
 */
export async function listStudentTopicAnalytics(studentId) {
  const snapshot = await getDocs(
    query(collection(db, COLLECTIONS.topicAnalytics), where("studentId", "==", studentId))
  );
  return mapCollection(snapshot);
}

/**
 * Create a practice task for a student
 */
export async function createPracticeTask({ studentId, subjectId, task }) {
  const tasksRef = collection(db, COLLECTIONS.practiceTasks);
  const payload = {
    studentId,
    subjectId,
    contestId: task.contestId || null, // null for historical/aggregated tasks
    questionType: task.questionType || "current", // "current" or "historical"
    title: task.title || "",
    description: task.description || "",
    codeTemplate: task.codeTemplate || "",
    testCases: task.testCases || [],
    expectedSolution: task.expectedSolution || null,
    topics: task.topics || [],
    difficulty: task.difficulty || "medium",
    status: "pending", // "pending", "in-progress", "completed"
    generatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  };
  return addDoc(tasksRef, payload);
}

/**
 * Get practice tasks for a student (optionally filtered by subject/type)
 * Note: Firestore requires composite indexes for multiple where clauses with orderBy
 * To avoid index requirements, we filter in memory after fetching
 */
export async function listPracticeTasks(studentId, filters = {}) {
  // Base query - only filter by studentId and order by createdAt
  // This avoids needing a composite index
  let q = query(
    collection(db, COLLECTIONS.practiceTasks),
    where("studentId", "==", studentId),
    orderBy("createdAt", "desc")
  );
  
  const snapshot = await getDocs(q);
  let tasks = mapCollection(snapshot);
  
  // Apply additional filters in memory to avoid composite index requirement
  if (filters.subjectId) {
    tasks = tasks.filter(t => t.subjectId === filters.subjectId);
  }
  if (filters.questionType) {
    tasks = tasks.filter(t => t.questionType === filters.questionType);
  }
  if (filters.status) {
    tasks = tasks.filter(t => t.status === filters.status);
  }
  
  return tasks;
}

/**
 * Update practice task status
 */
export async function updatePracticeTaskStatus(taskId, status, submission = null) {
  const taskRef = doc(db, COLLECTIONS.practiceTasks, taskId);
  const update = {
    status,
    updatedAt: serverTimestamp(),
  };
  if (submission) {
    update.lastSubmission = submission;
    update.completedAt = status === "completed" ? serverTimestamp() : null;
  }
  await setDoc(taskRef, update, { merge: true });
}

/**
 * Delete a contest and all its subcollections (questions, submissions, evaluations)
 */
export async function deleteContest(subjectId, contestId) {
  if (!subjectId || !contestId) {
    throw new Error("subjectId and contestId are required");
  }

  try {
    // Delete all questions
    const questionsRef = collection(db, COLLECTIONS.subjects, subjectId, COLLECTIONS.contests, contestId, COLLECTIONS.questions);
    const questionsSnapshot = await getDocs(questionsRef);
    const questionDeletes = questionsSnapshot.docs.map((qDoc) => deleteDoc(qDoc.ref));
    await Promise.all(questionDeletes);

    // Delete all submissions and their evaluations
    const submissionsRef = collection(db, COLLECTIONS.subjects, subjectId, COLLECTIONS.contests, contestId, COLLECTIONS.submissions);
    const submissionsSnapshot = await getDocs(submissionsRef);
    
    for (const subDoc of submissionsSnapshot.docs) {
      // Delete evaluations for this submission
      const evaluationsRef = collection(subDoc.ref, COLLECTIONS.evaluations);
      const evaluationsSnapshot = await getDocs(evaluationsRef);
      const evalDeletes = evaluationsSnapshot.docs.map((eDoc) => deleteDoc(eDoc.ref));
      await Promise.all(evalDeletes);
      
      // Delete the submission
      await deleteDoc(subDoc.ref);
    }

    // Delete the contest itself
    const contestRef = doc(db, COLLECTIONS.subjects, subjectId, COLLECTIONS.contests, contestId);
    await deleteDoc(contestRef);

    return { success: true };
  } catch (error) {
    console.error("Error deleting contest:", error);
    throw error;
  }
}

/**
 * Delete practice tasks for a student
 */
export async function deletePracticeTasks(studentId, filters = {}) {
  if (!studentId) {
    throw new Error("studentId is required");
  }

  try {
    const tasks = await listPracticeTasks(studentId, filters);
    const deletes = tasks.map((task) => deleteDoc(doc(db, COLLECTIONS.practiceTasks, task.id)));
    await Promise.all(deletes);
    return { deleted: tasks.length };
  } catch (error) {
    console.error("Error deleting practice tasks:", error);
    throw error;
  }
}

/**
 * Delete topic analytics for a student
 */
export async function deleteTopicAnalytics(studentId, subjectId = null) {
  if (!studentId) {
    throw new Error("studentId is required");
  }

  try {
    if (subjectId) {
      // Delete specific subject analytics
      const analyticsRef = doc(db, COLLECTIONS.topicAnalytics, `${studentId}_${subjectId}`);
      await deleteDoc(analyticsRef);
      return { deleted: 1 };
    } else {
      // Delete all analytics for student
      const allAnalytics = await listStudentTopicAnalytics(studentId);
      const deletes = allAnalytics.map((a) => {
        const analyticsRef = doc(db, COLLECTIONS.topicAnalytics, a.id);
        return deleteDoc(analyticsRef);
      });
      await Promise.all(deletes);
      return { deleted: allAnalytics.length };
    }
  } catch (error) {
    console.error("Error deleting topic analytics:", error);
    throw error;
  }
}

/**
 * Clean up all test data (contests with "Test Contest" in title, test practice tasks, etc.)
 */
export async function cleanupTestData() {
  try {
    const results = {
      contests: 0,
      practiceTasks: 0,
      topicAnalytics: 0,
      errors: [],
    };

    // Get all subjects
    const subjects = await listSubjects();
    
    // Find and delete test contests
    for (const subject of subjects) {
      const contests = await listContests(subject.id);
      for (const contest of contests) {
        if (contest.title && contest.title.includes("Test Contest")) {
          try {
            await deleteContest(subject.id, contest.id);
            results.contests++;
          } catch (error) {
            results.errors.push(`Failed to delete contest ${contest.id}: ${error.message}`);
          }
        }
      }
    }

    // Get all students and clean up their test data
    const students = await listStudents();
    for (const student of students) {
      try {
        // Delete practice tasks (we'll delete all for now, or filter by test data)
        const tasks = await listPracticeTasks(student.id);
        const testTasks = tasks.filter((task) => 
          task.title?.includes("Test") || 
          task.description?.includes("test") ||
          task.contestId?.includes("Test")
        );
        if (testTasks.length > 0) {
          const deletes = testTasks.map((task) => deleteDoc(doc(db, COLLECTIONS.practiceTasks, task.id)));
          await Promise.all(deletes);
          results.practiceTasks += testTasks.length;
        }
      } catch (error) {
        results.errors.push(`Failed to delete practice tasks for student ${student.id}: ${error.message}`);
      }
    }

    return results;
  } catch (error) {
    console.error("Error cleaning up test data:", error);
    throw error;
  }
}

export async function listStudentEvaluations(studentId, subjectId = null) {
  // This requires querying all contests, then all submissions, then all evaluations
  // For MVP, we'll get submissions and their evaluations
  const subjects = subjectId ? [{ id: subjectId }] : await listSubjects();
  const javaSubject = subjects.find((s) => s?.name?.toLowerCase() === "java");
  if (!javaSubject) return [];
  
  const contests = await listContests(javaSubject.id);
  const allEvaluations = [];
  
  for (const contest of contests) {
    const submissions = await listContestSubmissions(javaSubject.id, contest.id, studentId);
    for (const submission of submissions) {
      if (submission.status === "evaluated") {
        const evaluation = await getSubmissionEvaluation(javaSubject.id, contest.id, submission.id);
        if (evaluation) {
          allEvaluations.push({
            ...evaluation,
            subjectId: javaSubject.id,
            contestId: contest.id,
            contestTitle: contest.title,
            submissionId: submission.id,
            submittedAt: submission.submittedAt,
          });
        }
      }
    }
  }
  
  return allEvaluations.sort((a, b) => {
    const aTime = a.submittedAt?.seconds || 0;
    const bTime = b.submittedAt?.seconds || 0;
    return bTime - aTime;
  });
}

/**
 * Normalize topic name for consistent storage
 * @param {string} topic - Topic name to normalize
 * @returns {string} Normalized topic name (lowercase, trimmed)
 */
export function normalizeTopicName(topic) {
  if (!topic || typeof topic !== 'string') return '';
  return topic.toLowerCase().trim();
}

/**
 * Upsert important topics (impTopics) - increments topic counts atomically
 * @param {Object} topicUpdates - Object with topic names as keys and increment values (usually 1)
 * @example upsertImpTopics({ "arrays": 1, "loops": 1 })
 */
export async function upsertImpTopics(topicUpdates) {
  if (!topicUpdates || typeof topicUpdates !== 'object') {
    console.warn('upsertImpTopics: Invalid topicUpdates provided');
    return;
  }

  try {
    const impTopicsRef = doc(db, COLLECTIONS.impTopics, "global");
    const updates = {};
    
    // Normalize all topic names and prepare atomic increments
    for (const [topicName, incrementValue] of Object.entries(topicUpdates)) {
      const normalizedTopic = normalizeTopicName(topicName);
      if (normalizedTopic) {
        updates[normalizedTopic] = increment(incrementValue || 1);
      }
    }

    if (Object.keys(updates).length === 0) {
      console.warn('upsertImpTopics: No valid topics to update');
      return;
    }

    // Add metadata
    updates.updatedAt = serverTimestamp();

    await setDoc(impTopicsRef, updates, { merge: true });
    console.log(`✅ upsertImpTopics: Updated ${Object.keys(updates).length} topics`);
  } catch (error) {
    console.error('upsertImpTopics error:', error);
    throw new Error(`Failed to update impTopics: ${error.message}`);
  }
}

/**
 * Get all important topics with their counts
 * @returns {Promise<Object|null>} Object with topic names as keys and counts as values, or null if not found
 */
export async function getImpTopics() {
  try {
    const impTopicsRef = doc(db, COLLECTIONS.impTopics, "global");
    const snap = await getDoc(impTopicsRef);
    
    if (!snap.exists()) {
      return null;
    }

    const data = snap.data();
    // Remove metadata fields, return only topic counts
    const { updatedAt, ...topics } = data;
    return topics;
  } catch (error) {
    console.error('getImpTopics error:', error);
    throw new Error(`Failed to get impTopics: ${error.message}`);
  }
}

