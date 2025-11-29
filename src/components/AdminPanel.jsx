import { useEffect, useMemo, useRef, useState } from "react";
import {
  listSubjects,
  createSubject,
  createStudent,
  listContests,
  createContest,
  upsertStudentSubjectScore,
  listContestQuestions,
  listContestSubmissions,
  updateSubmissionStatus,
  createEvaluation,
  upsertTopicAnalytics,
  createPracticeTask,
  getTopicAnalytics,
  createSubmission,
  parseTestCases,
} from "../services/firestore.js";
import { evaluateCodeSubmission } from "../services/cursorAI.js";
import MonacoCodeEditor from "./MonacoCodeEditor.jsx";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../firebase/config.js";

const ADMIN_EMAIL = "Admin@gmail.com";
const ADMIN_PASSWORD = "Admin@123";
const SESSION_KEY = "vedam_admin_session";

const DEFAULT_SUBJECTS = [
  {
    name: "Maths",
    description: "Mathematics contest track for Vedam students.",
    order: 1,
  },
  {
    name: "Java",
    description: "Java programming contests and coding drills.",
    order: 2,
  },
  {
    name: "Web",
    description: "Web development challenges and workshops.",
    order: 3,
  },
];

const emptyErrorState = { email: "", password: "", global: "" };

const formatDate = (value) => {
  if (!value) return "Not scheduled";
  const date =
    value instanceof Date
      ? value
      : value?.seconds
      ? new Date(value.seconds * 1000)
      : typeof value === "string"
      ? new Date(value)
      : null;
  if (!date || Number.isNaN(date.getTime())) return "Not scheduled";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const AdminPanel = ({ onExit }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState(emptyErrorState);
  const [activeTab, setActiveTab] = useState("students");
  
  // Java contest management state
  const [javaContestForm, setJavaContestForm] = useState({
    subjectId: "",
    title: "",
    description: "",
    difficulty: "medium",
    topics: "",
    questions: [], // Array of {questionNumber, title, description, expectedSolution, testCases, maxScore}
  });
  const [currentQuestion, setCurrentQuestion] = useState({
    questionNumber: 1,
    title: "",
    description: "",
    expectedSolution: "",
    testCases: "", // Comma-separated or JSON
    maxScore: "",
    topics: "",
    difficulty: "medium",
  });
  const [javaContests, setJavaContests] = useState([]);
  const [selectedJavaContest, setSelectedJavaContest] = useState(null);
  const [javaSubmissions, setJavaSubmissions] = useState([]);
  const [contestQuestions, setContestQuestions] = useState([]);
  
  // Student submission upload form
  const [submissionForm, setSubmissionForm] = useState({
    studentId: "",
    questionId: "",
    studentCode: "",
  });
  const [uploadingSubmission, setUploadingSubmission] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadingBulkSubmissions, setUploadingBulkSubmissions] = useState(false);

  const [subjects, setSubjects] = useState([]);
  const [students, setStudents] = useState([]);
  const [contestsBySubject, setContestsBySubject] = useState({});
  const [rawScores, setRawScores] = useState({});
  const [lastMeritResult, setLastMeritResult] = useState(null);

  const [studentForm, setStudentForm] = useState({
    name: "",
    email: "",
    vedamId: "",
  });

  const [contestForm, setContestForm] = useState({
    subjectId: "",
    title: "",
    maxScore: "",
    scheduledAt: "",
  });

  const [marksForm, setMarksForm] = useState({
    studentId: "",
    subjectId: "",
    mockScore: "",
  });

  const [loading, setLoading] = useState({
    subjects: false,
    students: false,
    contests: false,
    studentSave: false,
    contestSave: false,
    marksSave: false,
  });

  const [feedback, setFeedback] = useState(null);
  const feedbackTimeout = useRef();

  useEffect(() => {
    const storedSession = sessionStorage.getItem(SESSION_KEY);
    if (storedSession === "true") {
      setIsAuthenticated(true);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    bootstrapData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  useEffect(() => {
    return () => {
      if (feedbackTimeout.current) {
        clearTimeout(feedbackTimeout.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!marksForm.subjectId) return;
    fetchContestsForSubject(marksForm.subjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marksForm.subjectId]);

  const setLoadingState = (key, value) =>
    setLoading((prev) => ({ ...prev, [key]: value }));

  const showFeedback = (type, message) => {
    if (feedbackTimeout.current) clearTimeout(feedbackTimeout.current);
    setFeedback({ type, message });
    feedbackTimeout.current = setTimeout(() => setFeedback(null), 4000);
  };

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    setLoadingState("students", true);

    const studentsQuery = query(
      collection(db, "students"),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      studentsQuery,
      (snapshot) => {
        const docs = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setStudents(docs);
        setMarksForm((prev) => ({
          ...prev,
          studentId: prev.studentId || docs[0]?.id || "",
        }));
        setLoadingState("students", false);
      },
      (error) => {
        console.error("Real-time student updates failed", error);
        showFeedback("error", "Live student updates interrupted.");
        setLoadingState("students", false);
      }
    );

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const bootstrapData = async () => {
    await loadSubjects();
  };

  const seedSubjectsIfEmpty = async (currentSubjects) => {
    if (currentSubjects.length) return currentSubjects;
    await Promise.all(
      DEFAULT_SUBJECTS.map((subject, index) =>
        createSubject({ ...subject, order: index })
      )
    );
    return listSubjects();
  };

  const loadSubjects = async () => {
    try {
      setLoadingState("subjects", true);
      let subjectDocs = await listSubjects();
      subjectDocs = await seedSubjectsIfEmpty(subjectDocs);
      setSubjects(subjectDocs);
      const firstSubjectId = subjectDocs[0]?.id ?? "";
      setContestForm((prev) => ({
        ...prev,
        subjectId: prev.subjectId || firstSubjectId,
      }));
      setMarksForm((prev) => ({
        ...prev,
        subjectId: prev.subjectId || firstSubjectId,
      }));
      if (firstSubjectId) {
        await fetchContestsForSubject(firstSubjectId);
      }
    } catch (error) {
      console.error("Failed to load subjects", error);
      showFeedback("error", "Failed to load subjects.");
    } finally {
      setLoadingState("subjects", false);
    }
  };

  const fetchContestsForSubject = async (subjectId) => {
    if (!subjectId) return [];
    try {
      setLoadingState("contests", true);
      const contests = await listContests(subjectId);
      setContestsBySubject((prev) => ({ ...prev, [subjectId]: contests }));
      setRawScores((prev) => ({
        ...prev,
        [subjectId]: contests.reduce((acc, contest) => {
          acc[contest.id] = prev[subjectId]?.[contest.id] ?? "";
          return acc;
        }, {}),
      }));
      return contests;
    } catch (error) {
      console.error("Failed to load contests", error);
      showFeedback("error", "Unable to load contests for the selected subject.");
      return [];
    } finally {
      setLoadingState("contests", false);
    }
  };

  const handleLogin = (event) => {
    event.preventDefault();
    const nextErrors = { ...emptyErrorState };

    if (!email.trim()) nextErrors.email = "Email is required";
    if (!password.trim()) nextErrors.password = "Password is required";

    if (!email.trim() || !password.trim()) {
      setErrors(nextErrors);
      return;
    }

    if (
      email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase() &&
      password === ADMIN_PASSWORD
    ) {
      sessionStorage.setItem(SESSION_KEY, "true");
      setIsAuthenticated(true);
      setErrors(emptyErrorState);
      setPassword("");
    } else {
      setErrors({
        ...emptyErrorState,
        global: "Invalid credentials. Please try again.",
      });
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setIsAuthenticated(false);
    setEmail("");
    setPassword("");
    setActiveTab("students");
    setSubjects([]);
    setStudents([]);
    setContestsBySubject({});
    setRawScores({});
    setLastMeritResult(null);
    if (typeof onExit === "function") {
      onExit();
    }
  };

  const handleStudentSubmit = async (event) => {
    event.preventDefault();
    if (!studentForm.name.trim() || !studentForm.email.trim()) {
      showFeedback("error", "Name and email are required.");
      return;
    }
    try {
      setLoadingState("studentSave", true);
      const docRef = await createStudent({
        name: studentForm.name.trim(),
        email: studentForm.email.trim(),
        vedamId: studentForm.vedamId.trim(),
      });
      setMarksForm((prev) => ({
        ...prev,
        studentId: prev.studentId || docRef.id,
      }));
      setStudentForm({ name: "", email: "", vedamId: "" });
      showFeedback("success", "Student added successfully.");
    } catch (error) {
      console.error("Failed to add student", error);
      showFeedback("error", "Failed to add student. Please retry.");
    } finally {
      setLoadingState("studentSave", false);
    }
  };

  const handleContestSubmit = async (event) => {
    event.preventDefault();
    const { subjectId, title, maxScore, scheduledAt } = contestForm;
    if (!subjectId || !title.trim() || !maxScore) {
      showFeedback("error", "Subject, title, and max score are required.");
      return;
    }
    try {
      setLoadingState("contestSave", true);
      await createContest(subjectId, {
        title: title.trim(),
        maxScore: Number(maxScore),
        scheduledAt: scheduledAt || undefined,
      });
      await fetchContestsForSubject(subjectId);
      showFeedback("success", "Contest created successfully.");
      setContestForm((prev) => ({
        ...prev,
        title: "",
        maxScore: "",
        scheduledAt: "",
      }));
    } catch (error) {
      console.error("Failed to create contest", error);
      showFeedback("error", "Failed to create contest. Please retry.");
    } finally {
      setLoadingState("contestSave", false);
    }
  };

  const handleMarksSubmit = async (event) => {
    event.preventDefault();
    const { studentId, subjectId, mockScore } = marksForm;
    if (!studentId || !subjectId) {
      showFeedback("error", "Select both student and subject first.");
      return;
    }

    const contests = contestsBySubject[subjectId] ?? [];
    if (!contests.length) {
      showFeedback(
        "error",
        "No contests found for this subject. Add contests first."
      );
      return;
    }

    try {
      setLoadingState("marksSave", true);
      const subjectRawScores = rawScores[subjectId] ?? {};
      const contestEntries = contests.map((contest) => ({
        contestId: contest.id,
        contestTitle: contest.title,
        rawScore: Number(subjectRawScores[contest.id] ?? 0),
        maxScore: Number(contest.maxScore ?? 0),
      }));

      const result = await upsertStudentSubjectScore({
        studentId,
        subjectId,
        contestEntries,
        mockScore: Number(mockScore ?? 0),
      });

      setLastMeritResult(result);
      showFeedback("success", "Vedam merit score updated.");
    } catch (error) {
      console.error("Failed to update merit score", error);
      showFeedback("error", "Failed to update merit score. Please retry.");
    } finally {
      setLoadingState("marksSave", false);
    }
  };

  const handleRawScoreChange = (subjectId, contestId, value) => {
    setRawScores((prev) => ({
      ...prev,
      [subjectId]: {
        ...(prev[subjectId] || {}),
        [contestId]: value,
      },
    }));
  };

  // ===== JAVA CONTEST HANDLERS =====
  
  const loadJavaContests = async () => {
    const javaSubject = subjects.find((s) => s?.name?.toLowerCase() === "java");
    if (!javaSubject) return;
    
    try {
      setLoadingState("contests", true);
      const contests = await listContests(javaSubject.id);
      setJavaContests(contests);
    } catch (error) {
      console.error("Failed to load Java contests", error);
      showFeedback("error", "Failed to load Java contests.");
    } finally {
      setLoadingState("contests", false);
    }
  };

  useEffect(() => {
    if (isAuthenticated && activeTab === "javaContests" && subjects.length) {
      loadJavaContests();
    }
  }, [isAuthenticated, activeTab, subjects]);

  const handleAddQuestion = () => {
    if (!currentQuestion.title.trim() || !currentQuestion.description.trim()) {
      showFeedback("error", "Question title and description are required.");
      return;
    }
    
    // Parse test cases consistently
    const testCases = parseTestCases(currentQuestion.testCases);
    console.log(`📋 handleAddQuestion: Parsed ${testCases.length} test cases for question "${currentQuestion.title}"`);

    const question = {
      questionNumber: javaContestForm.questions.length + 1,
      title: currentQuestion.title.trim(),
      description: currentQuestion.description.trim(),
      expectedSolution: currentQuestion.expectedSolution.trim(),
      testCases: Array.isArray(testCases) ? testCases : [],
      maxScore: Number(currentQuestion.maxScore) || 0,
      topics: currentQuestion.topics.split(",").map((t) => t.trim()).filter(Boolean),
      difficulty: currentQuestion.difficulty,
    };

    setJavaContestForm((prev) => ({
      ...prev,
      questions: [...prev.questions, question],
    }));

    // Reset form for next question
    setCurrentQuestion({
      questionNumber: question.questionNumber + 1,
      title: "",
      description: "",
      expectedSolution: "",
      testCases: "",
      maxScore: "",
      topics: "",
      difficulty: "medium",
    });
  };

  const handleRemoveQuestion = (index) => {
    setJavaContestForm((prev) => ({
      ...prev,
      questions: prev.questions.filter((_, i) => i !== index).map((q, i) => ({
        ...q,
        questionNumber: i + 1,
      })),
    }));
  };

  const handleJavaContestSubmit = async (event) => {
    event.preventDefault();
    const javaSubject = subjects.find((s) => s?.name?.toLowerCase() === "java");
    if (!javaSubject) {
      showFeedback("error", "Java subject not found. Please create it first.");
      return;
    }

    if (!javaContestForm.title.trim() || javaContestForm.questions.length === 0) {
      showFeedback("error", "Contest title and at least one question are required.");
      return;
    }

    try {
      setLoadingState("contestSave", true);
      const totalMaxScore = javaContestForm.questions.reduce(
        (sum, q) => sum + (q.maxScore || 0),
        0
      );

      await createContest(javaSubject.id, {
        title: javaContestForm.title.trim(),
        description: javaContestForm.description.trim(),
        maxScore: totalMaxScore,
        subjectType: "java",
        difficulty: javaContestForm.difficulty || "medium",
        topics: javaContestForm.topics.split(",").map((t) => t.trim()).filter(Boolean),
        questions: javaContestForm.questions,
        scheduledAt: new Date(),
      });

      showFeedback("success", "Java contest created successfully.");
      setJavaContestForm({
        subjectId: javaSubject.id,
        title: "",
        description: "",
        difficulty: "medium",
        topics: "",
        questions: [],
      });
      setCurrentQuestion({
        questionNumber: 1,
        title: "",
        description: "",
        expectedSolution: "",
        testCases: "",
        maxScore: "",
        topics: "",
        difficulty: "medium",
      });
      await loadJavaContests();
    } catch (error) {
      console.error("Failed to create Java contest", error);
      showFeedback("error", "Failed to create Java contest. Please retry.");
    } finally {
      setLoadingState("contestSave", false);
    }
  };

  // Handle JSON file upload for contest data
  const handleContestJSONUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      showFeedback("error", "Please upload a JSON file.");
      return;
    }

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Validate required fields
      if (!data.contestTitle) {
        showFeedback("error", "JSON must contain 'contestTitle' field.");
        return;
      }

      if (!Array.isArray(data.questions) || data.questions.length === 0) {
        showFeedback("error", "JSON must contain a non-empty 'questions' array.");
        return;
      }

      // Parse and validate questions
      const parsedQuestions = data.questions.map((q, index) => {
        if (!q.title || !q.description) {
          throw new Error(`Question ${index + 1} is missing title or description.`);
        }

        // Parse test cases
        let testCases = [];
        if (Array.isArray(q.testCases)) {
          testCases = q.testCases.map(tc => ({
            input: String(tc.input || ""),
            expectedOutput: String(tc.expectedOutput || ""),
          }));
        }

        return {
          questionNumber: q.questionNumber || index + 1,
          title: q.title.trim(),
          description: q.description.trim(),
          expectedSolution: q.expectedSolution ? q.expectedSolution.trim() : "",
          testCases: testCases,
          maxScore: Number(q.maxScore) || 0,
          topics: Array.isArray(q.topics) ? q.topics : (q.topics ? q.topics.split(",").map(t => t.trim()).filter(Boolean) : []),
          difficulty: q.difficulty || "medium",
        };
      });

      // Populate form
      setJavaContestForm({
        subjectId: "",
        title: data.contestTitle.trim(),
        description: data.description ? data.description.trim() : "",
        difficulty: data.difficulty || "medium",
        topics: Array.isArray(data.topics) ? data.topics.join(", ") : (data.topics || ""),
        questions: parsedQuestions,
      });

      showFeedback("success", `Successfully loaded ${parsedQuestions.length} questions from JSON. Review and submit.`);
    } catch (error) {
      console.error("Failed to parse contest JSON", error);
      showFeedback("error", `Failed to parse JSON: ${error.message}`);
    } finally {
      // Reset file input
      event.target.value = "";
    }
  };

  // Handle JSON file upload for bulk submissions
  const handleSubmissionsJSONUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      showFeedback("error", "Please upload a JSON file.");
      return;
    }

    if (!selectedJavaContest) {
      showFeedback("error", "Please select a contest first.");
      return;
    }

    try {
      setUploadingBulkSubmissions(true);
      const text = await file.text();
      const data = JSON.parse(text);

      if (!Array.isArray(data.submissions) || data.submissions.length === 0) {
        showFeedback("error", "JSON must contain a non-empty 'submissions' array.");
        return;
      }

      const javaSubject = subjects.find((s) => s?.name?.toLowerCase() === "java");
      if (!javaSubject) {
        showFeedback("error", "Java subject not found.");
        return;
      }

      let successCount = 0;
      let errorCount = 0;
      const errors = [];

      // Process each submission
      for (const submission of data.submissions) {
        try {
          // Find student by email or ID
          let student = null;
          if (submission.studentId) {
            student = students.find(s => s.id === submission.studentId);
          }
          if (!student && submission.studentEmail) {
            student = students.find(s => s.email.toLowerCase() === submission.studentEmail.toLowerCase());
          }

          if (!student) {
            throw new Error(`Student not found: ${submission.studentEmail || submission.studentId}`);
          }

          // Find question by number
          const question = contestQuestions.find(q => q.questionNumber === submission.questionNumber);
          if (!question) {
            throw new Error(`Question ${submission.questionNumber} not found in contest.`);
          }

          if (!submission.code || !submission.code.trim()) {
            throw new Error(`No code provided for question ${submission.questionNumber}.`);
          }

          // Upload submission
          const submissionRef = await createSubmission({
            subjectId: javaSubject.id,
            contestId: selectedJavaContest.id,
            studentId: student.id,
            questionId: question.id,
            code: submission.code.trim(),
            language: "java",
          });

          // Update status to submitted
          await updateSubmissionStatus(
            javaSubject.id,
            selectedJavaContest.id,
            submissionRef.id,
            "submitted"
          );

          // Trigger evaluation automatically (similar to handleUploadSubmission but simplified)
          try {
            await updateSubmissionStatus(
              javaSubject.id,
              selectedJavaContest.id,
              submissionRef.id,
              "evaluating"
            );

            // Get student history for context
            const topicAnalytics = await getTopicAnalytics(student.id, javaSubject.id);

            // Parse testCases consistently
            const parsedTestCases = parseTestCases(question.testCases);

            // Call AI evaluation
            const evaluation = await evaluateCodeSubmission({
              studentCode: submission.code.trim(),
              expectedSolution: question.expectedSolution || "",
              questionDescription: question.description || question.title,
              testCases: parsedTestCases,
              studentHistory: topicAnalytics
                ? {
                    weakTopics: Object.entries(topicAnalytics.topics || {})
                      .filter(([_, data]) => data.strength === "weak" || data.score < 50)
                      .map(([topic, _]) => topic),
                    strongTopics: Object.entries(topicAnalytics.topics || {})
                      .filter(([_, data]) => data.strength === "strong" || data.score >= 75)
                      .map(([topic, _]) => topic),
                    trends: topicAnalytics.topics || {},
                  }
                : null,
            });

            // Save evaluation
            await createEvaluation({
              subjectId: javaSubject.id,
              contestId: selectedJavaContest.id,
              submissionId: submissionRef.id,
              report: evaluation,
            });

            // Update topic analytics
            const topicUpdates = {};
            for (const [topic, score] of Object.entries(evaluation.topicScores || {})) {
              topicUpdates[topic] = {
                score: Number(score),
                strength: score >= 75 ? "strong" : score < 50 ? "weak" : "medium",
              };
            }
            await upsertTopicAnalytics({
              studentId: student.id,
              subjectId: javaSubject.id,
              topicUpdates,
            });

            // Update submission status to evaluated
            await updateSubmissionStatus(
              javaSubject.id,
              selectedJavaContest.id,
              submissionRef.id,
              "evaluated"
            );
          } catch (evalError) {
            console.error("Failed to evaluate submission", evalError);
            // Update status to error but continue
            try {
              await updateSubmissionStatus(
                javaSubject.id,
                selectedJavaContest.id,
                submissionRef.id,
                "error"
              );
            } catch (statusError) {
              console.error("Failed to update submission status", statusError);
            }
            throw evalError; // Re-throw to count as error
          }

          successCount++;
        } catch (error) {
          errorCount++;
          errors.push(`${submission.studentEmail || submission.studentId} - Q${submission.questionNumber}: ${error.message}`);
          console.error("Failed to upload submission", error);
        }
      }

      // Reload submissions
      const [submissions] = await Promise.all([
        listContestSubmissions(javaSubject.id, selectedJavaContest.id),
      ]);
      setJavaSubmissions(submissions);

      if (errorCount > 0) {
        showFeedback("warning", `Uploaded ${successCount} submissions. ${errorCount} failed. Check console for details.`);
        console.error("Upload errors:", errors);
      } else {
        showFeedback("success", `Successfully uploaded ${successCount} submissions.`);
      }
    } catch (error) {
      console.error("Failed to parse submissions JSON", error);
      showFeedback("error", `Failed to parse JSON: ${error.message}`);
    } finally {
      setUploadingBulkSubmissions(false);
      event.target.value = "";
    }
  };

  const handleViewContestSubmissions = async (contest) => {
    const javaSubject = subjects.find((s) => s?.name?.toLowerCase() === "java");
    if (!javaSubject) return;
    
    try {
      setLoadingState("contests", true);
      const [submissions, questions] = await Promise.all([
        listContestSubmissions(javaSubject.id, contest.id),
        listContestQuestions(javaSubject.id, contest.id),
      ]);
      setJavaSubmissions(submissions);
      setContestQuestions(questions);
      setSelectedJavaContest(contest);
      setSubmissionForm((prev) => ({
        ...prev,
        questionId: questions[0]?.id || "",
      }));
    } catch (error) {
      console.error("Failed to load submissions", error);
      showFeedback("error", "Failed to load submissions.");
    } finally {
      setLoadingState("contests", false);
    }
  };

  const handleUploadSubmission = async (event) => {
    event.preventDefault();
    
    // Comprehensive validation with detailed error messages
    if (!selectedJavaContest) {
      showFeedback("error", "No contest selected. Please select a Java contest first.");
      return;
    }
    if (!submissionForm.studentId) {
      showFeedback("error", "No student selected. Please select a student first.");
      return;
    }
    if (!submissionForm.questionId) {
      showFeedback("error", "No question selected. Please select a question first.");
      return;
    }
    if (!submissionForm.studentCode || !submissionForm.studentCode.trim()) {
      showFeedback("error", "Student code is empty. Please provide the student's code submission.");
      return;
    }
    
    console.log(`📤 handleUploadSubmission: Starting upload for student ${submissionForm.studentId}, contest ${selectedJavaContest.title}`);

    const javaSubject = subjects.find((s) => s?.name?.toLowerCase() === "java");
    if (!javaSubject) return;

    setUploadingSubmission(true);
    let submissionRef = null;
    
    try {
      // Create submission
      submissionRef = await createSubmission({
        subjectId: javaSubject.id,
        contestId: selectedJavaContest.id,
        studentId: submissionForm.studentId,
        questionId: submissionForm.questionId,
        code: submissionForm.studentCode.trim(),
        language: "java",
      });

      // Update status to submitted
      await updateSubmissionStatus(
        javaSubject.id,
        selectedJavaContest.id,
        submissionRef.id,
        "submitted"
      );

      // Automatically trigger AI evaluation
      showFeedback("success", "Submission uploaded. Starting AI evaluation...");
      
      // Get question details for evaluation
      const question = contestQuestions.find((q) => q.id === submissionForm.questionId);
      if (!question) {
        throw new Error("Question not found");
      }

      // Update status to evaluating
      await updateSubmissionStatus(
        javaSubject.id,
        selectedJavaContest.id,
        submissionRef.id,
        "evaluating"
      );

      // Get student history for context
      const topicAnalytics = await getTopicAnalytics(submissionForm.studentId, javaSubject.id);

      // Parse testCases consistently
      const parsedTestCases = parseTestCases(question.testCases);
      console.log(`📋 handleUploadSubmission: Using ${parsedTestCases.length} test cases for evaluation`);

      // Call AI evaluation
      const evaluation = await evaluateCodeSubmission({
        studentCode: submissionForm.studentCode.trim(),
        expectedSolution: question.expectedSolution || "",
        questionDescription: question.description || question.title,
        testCases: parsedTestCases,
        studentHistory: topicAnalytics
          ? {
              weakTopics: Object.entries(topicAnalytics.topics || {})
                .filter(([_, data]) => data.strength === "weak" || data.score < 50)
                .map(([topic, _]) => topic),
              strongTopics: Object.entries(topicAnalytics.topics || {})
                .filter(([_, data]) => data.strength === "strong" || data.score >= 75)
                .map(([topic, _]) => topic),
              trends: topicAnalytics.topics || {},
            }
          : null,
      });

      // Save evaluation
      await createEvaluation({
        subjectId: javaSubject.id,
        contestId: selectedJavaContest.id,
        submissionId: submissionRef.id,
        report: evaluation,
      });

      // Update topic analytics
      const topicUpdates = {};
      for (const [topic, score] of Object.entries(evaluation.topicScores || {})) {
        topicUpdates[topic] = {
          score: Number(score),
          strength: score >= 75 ? "strong" : score < 50 ? "weak" : "medium",
        };
      }
      await upsertTopicAnalytics({
        studentId: submissionForm.studentId,
        subjectId: javaSubject.id,
        topicUpdates,
      });

      // Generate 5-10 practice questions from current contest evaluation
      const practiceQuestions = evaluation.practiceQuestions || [];
      const questionsToGenerate = Math.min(Math.max(5, practiceQuestions.length), 10);
      
      for (let i = 0; i < questionsToGenerate; i++) {
        const practiceQ = practiceQuestions[i];
        if (practiceQ) {
          await createPracticeTask({
            studentId: submissionForm.studentId,
            subjectId: javaSubject.id,
            task: {
              contestId: selectedJavaContest.id,
              questionType: "current", // Current contest practice
              ...practiceQ,
            },
          });
        }
      }

      // Update submission status
      await updateSubmissionStatus(
        javaSubject.id,
        selectedJavaContest.id,
        submissionRef.id,
        "evaluated",
        { evaluatedAt: new Date() }
      );

      showFeedback("success", "Submission evaluated! Report and practice questions generated on student dashboard.");
      
      // Reset form
      setSubmissionForm({
        studentId: submissionForm.studentId, // Keep student selected
        questionId: contestQuestions[0]?.id || "",
        studentCode: "",
      });
      setShowUploadForm(false);
      
      // Reload submissions
      await handleViewContestSubmissions(selectedJavaContest);
    } catch (error) {
      console.error("Failed to upload and evaluate submission", error);
      showFeedback("error", `Failed: ${error.message}`);
      if (submissionRef) {
        await updateSubmissionStatus(
          javaSubject.id,
          selectedJavaContest.id,
          submissionRef.id,
          "error",
          { error: error.message }
        );
      }
    } finally {
      setUploadingSubmission(false);
    }
  };

  const handleEvaluateSubmission = async (submission) => {
    if (!selectedJavaContest) return;
    
    const javaSubject = subjects.find((s) => s?.name?.toLowerCase() === "java");
    if (!javaSubject) return;

    try {
      setLoadingState("marksSave", true);
      await updateSubmissionStatus(
        javaSubject.id,
        selectedJavaContest.id,
        submission.id,
        "evaluating"
      );

      // Get question details
      const questions = await listContestQuestions(javaSubject.id, selectedJavaContest.id);
      const question = questions.find((q) => q.id === submission.questionId);
      if (!question) {
        throw new Error("Question not found");
      }

      // Get student history for context
      const topicAnalytics = await getTopicAnalytics(submission.studentId, javaSubject.id);

      // Parse testCases consistently
      const parsedTestCases = parseTestCases(question.testCases);
      console.log(`📋 handleEvaluateSubmission: Using ${parsedTestCases.length} test cases for evaluation`);

      // Call AI evaluation
      const evaluation = await evaluateCodeSubmission({
        studentCode: submission.code,
        expectedSolution: question.expectedSolution || "",
        questionDescription: question.description || question.title,
        testCases: parsedTestCases,
        studentHistory: topicAnalytics
          ? {
              weakTopics: Object.entries(topicAnalytics.topics || {})
                .filter(([_, data]) => data.strength === "weak" || data.score < 50)
                .map(([topic, _]) => topic),
              strongTopics: Object.entries(topicAnalytics.topics || {})
                .filter(([_, data]) => data.strength === "strong" || data.score >= 75)
                .map(([topic, _]) => topic),
              trends: topicAnalytics.topics || {},
            }
          : null,
      });

      // Save evaluation
      await createEvaluation({
        subjectId: javaSubject.id,
        contestId: selectedJavaContest.id,
        submissionId: submission.id,
        report: evaluation,
      });

      // Update topic analytics
      const topicUpdates = {};
      for (const [topic, score] of Object.entries(evaluation.topicScores || {})) {
        topicUpdates[topic] = {
          score: Number(score),
          strength: score >= 75 ? "strong" : score < 50 ? "weak" : "medium",
        };
      }
      await upsertTopicAnalytics({
        studentId: submission.studentId,
        subjectId: javaSubject.id,
        topicUpdates,
      });

      // Create practice tasks
      for (const practiceQ of evaluation.practiceQuestions || []) {
        await createPracticeTask({
          studentId: submission.studentId,
          subjectId: javaSubject.id,
          task: {
            contestId: selectedJavaContest.id,
            questionType: "current",
            ...practiceQ,
          },
        });
      }

      // Update submission status
      await updateSubmissionStatus(
        javaSubject.id,
        selectedJavaContest.id,
        submission.id,
        "evaluated",
        { evaluatedAt: new Date() }
      );

      showFeedback("success", "Submission evaluated successfully.");
      await handleViewContestSubmissions(selectedJavaContest);
    } catch (error) {
      console.error("Failed to evaluate submission", error);
      showFeedback("error", `Evaluation failed: ${error.message}`);
      await updateSubmissionStatus(
        javaSubject.id,
        selectedJavaContest.id,
        submission.id,
        "error",
        { error: error.message }
      );
    } finally {
      setLoadingState("marksSave", false);
    }
  };

  const tabSummary = useMemo(
    () => ({
      students: {
        title: "Students",
        description:
          "Add new Vedam students and view the current registry of participants.",
      },
      contests: {
        title: "Contests",
        description:
          "Track contest roster per subject and define scoring parameters.",
      },
      javaContests: {
        title: "Upload Contest Results",
        description:
          "Upload contest questions, expected solutions, and student submissions. AI will automatically evaluate and generate reports.",
      },
      marks: {
        title: "Marks & Merit",
        description:
          "Record contest results, normalize scores, and publish Vedam totals.",
      },
    }),
    []
  );

  if (!isAuthenticated) {
    return (
      <section className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-md p-8">
          <header className="mb-6">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Admin Access</h2>
            <p className="text-sm text-slate-600">Sign in with the provided credentials to manage Vedam data.</p>
          </header>
          {errors.global && (
            <div className="p-3 rounded-lg bg-red-50 text-red-700 border border-red-200 text-sm mb-4">{errors.global}</div>
          )}
          <form onSubmit={handleLogin} className="space-y-4">
            <label className="block">
              <span className="block text-sm font-medium text-slate-700 mb-1">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Admin@gmail.com"
                className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
              {errors.email && <small className="text-red-600 text-xs mt-1 block">{errors.email}</small>}
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-slate-700 mb-1">Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Admin@123"
                className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
              {errors.password && <small className="text-red-600 text-xs mt-1 block">{errors.password}</small>}
            </label>
            <button type="submit" className="w-full px-4 py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors">
              Enter Admin Panel
            </button>
          </form>
        </div>
      </section>
    );
  }

  const activeSummary = tabSummary[activeTab];
  const currentSubjectContests =
    (marksForm.subjectId && contestsBySubject[marksForm.subjectId]) || [];
  const subjectOptions = subjects.map((subject) => ({
    id: subject.id,
    name: subject.name,
  }));

  return (
    <section className="min-h-screen bg-slate-50 p-6 md:p-10">
      <header className="flex justify-between items-start gap-4 flex-wrap mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Vedam Admin Dashboard</h2>
          <p className="text-sm text-slate-600">
            {activeSummary?.description ??
              "Manage students, contests, and Vedam merit scores."}
          </p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="px-4 py-2 bg-red-50 text-red-700 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors"
        >
          Sign out
        </button>
      </header>

      {feedback && (
        <div
          className={`p-4 rounded-lg text-sm font-medium mb-6 ${
            feedback.type === "success"
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
          role="status"
        >
          {feedback.message}
        </div>
      )}

      <div className="flex gap-2 flex-wrap mb-6">
        {Object.entries(tabSummary).map(([tabId, meta]) => (
          <button
            key={tabId}
            type="button"
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tabId
                ? "bg-emerald-600 text-white"
                : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
            onClick={() => setActiveTab(tabId)}
          >
            <span>{meta.title}</span>
          </button>
        ))}
      </div>

      <div className="space-y-6">
        {activeTab === "students" && (
          <div className="space-y-6">
            <form className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8" onSubmit={handleStudentSubmit}>
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Add new student</h3>
                <p className="text-sm text-slate-600">
                  Register a Vedam student to unlock contest tracking on their dashboard.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <label className="block">
                  <span className="block text-sm font-medium text-slate-700 mb-1">Name</span>
                  <input
                    type="text"
                    value={studentForm.name}
                    onChange={(event) =>
                      setStudentForm((prev) => ({
                        ...prev,
                        name: event.target.value,
                      }))
                    }
                    placeholder="Sidhant Joshi"
                    required
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium text-slate-700 mb-1">Email</span>
                  <input
                    type="email"
                    value={studentForm.email}
                    onChange={(event) =>
                      setStudentForm((prev) => ({
                        ...prev,
                        email: event.target.value,
                      }))
                    }
                    placeholder="student@vedamsot.org"
                    required
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium text-slate-700 mb-1">Vedam ID (optional)</span>
                  <input
                    type="text"
                    value={studentForm.vedamId}
                    onChange={(event) =>
                      setStudentForm((prev) => ({
                        ...prev,
                        vedamId: event.target.value,
                      }))
                    }
                    placeholder="VED-XXXX"
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </label>
              </div>
              <button
                type="submit"
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={loading.studentSave}
              >
                {loading.studentSave ? "Saving..." : "Add student"}
              </button>
            </form>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-slate-900">Registered students</h3>
                <span className="text-sm text-slate-600">{students.length} total</span>
              </div>
              {loading.students ? (
                <div className="p-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-600 text-sm">
                  Loading students…
                </div>
              ) : students.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Name</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Email</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Vedam ID</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Registered</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {students.map((student) => (
                        <tr key={student.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 text-sm text-slate-900">{student.name}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{student.email}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{student.vedamId || "—"}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{formatDate(student.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="p-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-600 text-sm">
                  No students yet. Add the first participant using the form above.
                </p>
              )}
            </div>
          </div>
        )}

        {activeTab === "contests" && (
          <div className="space-y-6">
            <form className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8" onSubmit={handleContestSubmit}>
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Create contest</h3>
                <p className="text-sm text-slate-600">Define a contest and its maximum marks for normalization.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <label className="block">
                  <span className="block text-sm font-medium text-slate-700 mb-1">Subject</span>
                  <select
                    value={contestForm.subjectId}
                    onChange={(event) => {
                      const nextId = event.target.value;
                      setContestForm((prev) => ({
                        ...prev,
                        subjectId: nextId,
                      }));
                      fetchContestsForSubject(nextId);
                    }}
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  >
                    {subjectOptions.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-sm font-medium text-slate-700 mb-1">Contest title</span>
                  <input
                    type="text"
                    value={contestForm.title}
                    onChange={(event) =>
                      setContestForm((prev) => ({
                        ...prev,
                        title: event.target.value,
                      }))
                    }
                    placeholder="Java Contest - April"
                    required
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium text-slate-700 mb-1">Maximum marks</span>
                  <input
                    type="number"
                    min="1"
                    value={contestForm.maxScore}
                    onChange={(event) =>
                      setContestForm((prev) => ({
                        ...prev,
                        maxScore: event.target.value,
                      }))
                    }
                    placeholder="100"
                    required
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium text-slate-700 mb-1">Contest date</span>
                  <input
                    type="date"
                    value={contestForm.scheduledAt}
                    onChange={(event) =>
                      setContestForm((prev) => ({
                        ...prev,
                        scheduledAt: event.target.value,
                      }))
                    }
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </label>
              </div>
              <button
                type="submit"
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={loading.contestSave}
              >
                {loading.contestSave ? "Saving..." : "Create contest"}
              </button>
            </form>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-slate-900">Contests</h3>
                <span className="text-sm text-slate-600">
                  {(contestsBySubject[contestForm.subjectId]?.length ?? 0)} listed
                </span>
              </div>
              {loading.contests ? (
                <div className="p-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-600 text-sm">
                  Loading contests…
                </div>
              ) : (contestsBySubject[contestForm.subjectId] || []).length ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Title</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Max marks</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Scheduled</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {contestsBySubject[contestForm.subjectId].map((contest) => (
                        <tr key={contest.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 text-sm text-slate-900">{contest.title}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{contest.maxScore}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{formatDate(contest.scheduledAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="p-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-600 text-sm">
                  No contests for this subject yet. Use the form to add one.
                </p>
              )}
            </div>
          </div>
        )}

        {activeTab === "javaContests" && (
          <div className="space-y-6">
            {!selectedJavaContest ? (
              <>
                <form className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8" onSubmit={handleJavaContestSubmit}>
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold text-slate-900 mb-2">Upload Contest Results</h3>
                    <p className="text-sm text-slate-600">
                      <strong>Note:</strong> Contests happen on the college portal. This platform is for uploading results and generating student reports.
                      <br />
                      Upload contest questions, expected solutions, and student submissions. AI will automatically evaluate submissions and generate reports on student dashboards.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <label className="block">
                      <span className="block text-sm font-medium text-slate-700 mb-1">Contest Title</span>
                      <input
                        type="text"
                        value={javaContestForm.title}
                        onChange={(e) =>
                          setJavaContestForm((prev) => ({ ...prev, title: e.target.value }))
                        }
                        placeholder="Java Contest #1"
                        required
                        className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-sm font-medium text-slate-700 mb-1">Difficulty</span>
                      <select
                        value={javaContestForm.difficulty}
                        onChange={(e) =>
                          setJavaContestForm((prev) => ({ ...prev, difficulty: e.target.value }))
                        }
                        className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                      >
                        <option value="easy">Easy</option>
                        <option value="medium">Medium</option>
                        <option value="hard">Hard</option>
                      </select>
                    </label>
                  </div>

                  <label className="block mb-4">
                    <span className="block text-sm font-medium text-slate-700 mb-1">Description</span>
                    <textarea
                      value={javaContestForm.description}
                      onChange={(e) =>
                        setJavaContestForm((prev) => ({ ...prev, description: e.target.value }))
                      }
                      placeholder="Contest description..."
                      rows={3}
                      className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-y"
                    />
                  </label>

                  <label className="block mb-4">
                    <span className="block text-sm font-medium text-slate-700 mb-1">Topics (comma-separated)</span>
                    <input
                      type="text"
                      value={javaContestForm.topics}
                      onChange={(e) =>
                        setJavaContestForm((prev) => ({ ...prev, topics: e.target.value }))
                      }
                      placeholder="arrays, loops, recursion"
                      className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    />
                  </label>

                  <div className="border-t border-slate-200 pt-6 mt-6">
                    <div className="flex justify-between items-center mb-4">
                      <h4 className="text-base font-semibold text-slate-900">Add Questions</h4>
                      <label className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors cursor-pointer">
                        <input
                          type="file"
                          accept=".json"
                          onChange={handleContestJSONUpload}
                          className="hidden"
                        />
                        📁 Upload Contest JSON
                      </label>
                    </div>
                    <p className="text-xs text-slate-500 mb-4">
                      Upload a JSON file with contest data. See <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">JSON_FORMAT_GUIDE.md</code> in the project root for format details.
                    </p>
                  </div>

                  {javaContestForm.questions.length > 0 && (
                    <div className="space-y-3 mb-6">
                      {javaContestForm.questions.map((q, idx) => (
                        <div key={idx} className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                          <div className="flex justify-between items-start mb-2">
                            <strong className="text-slate-900">Q{q.questionNumber}: {q.title}</strong>
                            <button
                              type="button"
                              onClick={() => handleRemoveQuestion(idx)}
                              className="px-3 py-1 text-sm text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                            >
                              Remove
                            </button>
                          </div>
                          <p className="text-sm text-slate-600 mb-1">{q.description}</p>
                          <small className="text-xs text-slate-500">
                            {q.testCases.length} test cases · {q.topics.join(", ")}
                          </small>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="bg-slate-50 rounded-lg p-6 border border-slate-200 space-y-4">
                    <h4 className="text-base font-semibold text-slate-900">Add New Question</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <label className="block">
                        <span className="block text-sm font-medium text-slate-700 mb-1">Question Title</span>
                        <input
                          type="text"
                          value={currentQuestion.title}
                          onChange={(e) =>
                            setCurrentQuestion((prev) => ({ ...prev, title: e.target.value }))
                          }
                          placeholder="Reverse a String"
                          className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-sm font-medium text-slate-700 mb-1">Max Score</span>
                        <input
                          type="number"
                          value={currentQuestion.maxScore}
                          onChange={(e) =>
                            setCurrentQuestion((prev) => ({ ...prev, maxScore: e.target.value }))
                          }
                          placeholder="10"
                          className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                        />
                      </label>
                    </div>

                    <label className="block">
                      <span className="block text-sm font-medium text-slate-700 mb-1">Question Description</span>
                      <textarea
                        value={currentQuestion.description}
                        onChange={(e) =>
                          setCurrentQuestion((prev) => ({ ...prev, description: e.target.value }))
                        }
                        placeholder="Write a function to reverse a string..."
                        rows={4}
                        className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-y"
                      />
                    </label>

                    <label className="block">
                      <span className="block text-sm font-medium text-slate-700 mb-1">Expected Solution (Reference Code)</span>
                      <div className="mt-1">
                        <MonacoCodeEditor
                          value={currentQuestion.expectedSolution}
                          onChange={(value) =>
                            setCurrentQuestion((prev) => ({
                              ...prev,
                              expectedSolution: value,
                            }))
                          }
                          height="300px"
                          language="java"
                          placeholder="public class Solution {&#10;  public String reverse(String s) {&#10;    // Reference implementation&#10;  }&#10;}"
                        />
                      </div>
                    </label>

                    <label className="block">
                      <span className="block text-sm font-medium text-slate-700 mb-1">
                        Test Cases (JSON array or comma-separated input:output pairs)
                      </span>
                      <textarea
                        value={currentQuestion.testCases}
                        onChange={(e) =>
                          setCurrentQuestion((prev) => ({ ...prev, testCases: e.target.value }))
                        }
                        placeholder='[{"input": "hello", "expectedOutput": "olleh"}, ...]'
                        rows={4}
                        className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono text-sm resize-y"
                      />
                      <span className="text-xs text-slate-500 mt-1 block">
                        Format: JSON array or "input1:output1, input2:output2"
                      </span>
                    </label>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <label className="block">
                        <span className="block text-sm font-medium text-slate-700 mb-1">Topics (comma-separated)</span>
                        <input
                          type="text"
                          value={currentQuestion.topics}
                          onChange={(e) =>
                            setCurrentQuestion((prev) => ({ ...prev, topics: e.target.value }))
                          }
                          placeholder="strings, algorithms"
                          className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-sm font-medium text-slate-700 mb-1">Difficulty</span>
                        <select
                          value={currentQuestion.difficulty}
                          onChange={(e) =>
                            setCurrentQuestion((prev) => ({
                              ...prev,
                              difficulty: e.target.value,
                            }))
                          }
                          className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                        >
                          <option value="easy">Easy</option>
                          <option value="medium">Medium</option>
                          <option value="hard">Hard</option>
                        </select>
                      </label>
                    </div>

                    <button
                      type="button"
                      onClick={handleAddQuestion}
                      className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-300 transition-colors"
                    >
                      + Add Question
                    </button>
                  </div>

                  <button
                    type="submit"
                    className="mt-6 px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={loading.contestSave || javaContestForm.questions.length === 0}
                  >
                    {loading.contestSave ? "Uploading..." : "Upload Contest Results"}
                  </button>
                </form>

                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-slate-900">Java Contests</h3>
                    <span className="text-sm text-slate-600">{javaContests.length} total</span>
                  </div>
                  {loading.contests ? (
                    <div className="p-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-600 text-sm">
                      Loading contests…
                    </div>
                  ) : javaContests.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Title</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Difficulty</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Questions</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {javaContests.map((contest) => (
                            <tr key={contest.id} className="hover:bg-slate-50">
                              <td className="px-4 py-3 text-sm text-slate-900">{contest.title}</td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  contest.difficulty === "easy" ? "bg-green-100 text-green-700" :
                                  contest.difficulty === "hard" ? "bg-red-100 text-red-700" :
                                  "bg-yellow-100 text-yellow-700"
                                }`}>
                                  {contest.difficulty || "medium"}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-slate-600">
                                {contest.questionsCount || "—"}
                              </td>
                              <td className="px-4 py-3">
                                <button
                                  type="button"
                                  onClick={() => handleViewContestSubmissions(contest)}
                                  className="px-3 py-1 text-sm bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 transition-colors"
                                >
                                  View Submissions
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="p-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-600 text-sm">
                      No contest results uploaded yet. Use the form above to upload contest questions and expected solutions.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-6">
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8">
                  <div className="flex flex-col gap-4 mb-6">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedJavaContest(null);
                        setJavaSubmissions([]);
                        setShowUploadForm(false);
                      }}
                      className="self-start px-3 py-1 text-sm text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                    >
                      ← Back to Contests
                    </button>
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900 mb-2">{selectedJavaContest.title} - Upload Student Submissions</h3>
                      <p className="text-sm text-slate-600">
                        Upload student code submissions from the contest. AI will automatically evaluate and generate reports on student dashboards.
                      </p>
                    </div>
                    <div className="flex gap-3 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setShowUploadForm(!showUploadForm)}
                        className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
                      >
                        {showUploadForm ? "Hide Upload Form" : "+ Upload Single Submission"}
                      </button>
                      <label className="px-4 py-2 bg-slate-600 text-white rounded-lg text-sm font-medium hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                        <input
                          type="file"
                          accept=".json"
                          onChange={handleSubmissionsJSONUpload}
                          className="hidden"
                          disabled={uploadingBulkSubmissions}
                        />
                        {uploadingBulkSubmissions ? "Uploading..." : "📁 Upload Submissions JSON"}
                      </label>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                      Upload multiple submissions at once. See <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">JSON_FORMAT_GUIDE.md</code> in the project root for format details.
                    </p>
                  </div>

                  {showUploadForm && (
                    <form className="space-y-4" onSubmit={handleUploadSubmission}>
                      <div className="mb-4">
                        <h4 className="text-base font-semibold text-slate-900 mb-1">Upload Student Submission</h4>
                        <p className="text-sm text-slate-600">Upload code submitted by a student during the contest. Evaluation will start automatically.</p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="block">
                          <span className="block text-sm font-medium text-slate-700 mb-1">Student</span>
                          <select
                            value={submissionForm.studentId}
                            onChange={(e) =>
                              setSubmissionForm((prev) => ({
                                ...prev,
                                studentId: e.target.value,
                              }))
                            }
                            required
                            className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                          >
                            <option value="">Select student</option>
                            {students.map((student) => (
                              <option key={student.id} value={student.id}>
                                {student.name} ({student.email})
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="block text-sm font-medium text-slate-700 mb-1">Question</span>
                          <select
                            value={submissionForm.questionId}
                            onChange={(e) =>
                              setSubmissionForm((prev) => ({
                                ...prev,
                                questionId: e.target.value,
                              }))
                            }
                            required
                            className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                          >
                            <option value="">Select question</option>
                            {contestQuestions.map((q) => (
                              <option key={q.id} value={q.id}>
                                Q{q.questionNumber}: {q.title}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <label className="block">
                        <span className="block text-sm font-medium text-slate-700 mb-1">Student's Submitted Code</span>
                        <div className="mt-1">
                          <MonacoCodeEditor
                            value={submissionForm.studentCode}
                            onChange={(value) =>
                              setSubmissionForm((prev) => ({
                                ...prev,
                                studentCode: value,
                              }))
                            }
                            height="300px"
                            language="java"
                            placeholder="Paste the code submitted by the student during the contest..."
                          />
                        </div>
                      </label>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={uploadingSubmission}
                      >
                        {uploadingSubmission ? "Uploading & Evaluating..." : "Upload & Evaluate"}
                      </button>
                    </form>
                  )}
                </div>

                {loading.contests ? (
                  <div className="p-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-600 text-sm">
                    Loading submissions…
                  </div>
                ) : javaSubmissions.length ? (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-semibold text-slate-900">Uploaded Submissions</h3>
                      <span className="text-sm text-slate-600">{javaSubmissions.length} total</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Student</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Question</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Status</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Uploaded</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {javaSubmissions.map((submission) => {
                            const student = students.find((s) => s.id === submission.studentId);
                            const question = contestQuestions.find((q) => q.id === submission.questionId);
                            return (
                              <tr key={submission.id} className="hover:bg-slate-50">
                                <td className="px-4 py-3 text-sm text-slate-900">{student?.name || submission.studentId}</td>
                                <td className="px-4 py-3 text-sm text-slate-600">{question ? `Q${question.questionNumber}: ${question.title}` : `Q${submission.questionId}`}</td>
                                <td className="px-4 py-3">
                                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                    submission.status === "evaluated" ? "bg-emerald-100 text-emerald-700" :
                                    submission.status === "pending" ? "bg-yellow-100 text-yellow-700" :
                                    "bg-slate-100 text-slate-700"
                                  }`}>
                                    {submission.status}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-sm text-slate-600">{formatDate(submission.submittedAt)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <p className="p-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-600 text-sm">
                    No submissions uploaded yet. Use the upload form above to add student submissions.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "marks" && (
          <div className="space-y-6">
            <form className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8" onSubmit={handleMarksSubmit}>
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Publish Vedam merit score</h3>
                <p className="text-sm text-slate-600">
                  Enter contest marks and mock score. We will normalize, scale, and
                  store the totals automatically.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <label className="block">
                  <span className="block text-sm font-medium text-slate-700 mb-1">Student</span>
                  <select
                    value={marksForm.studentId}
                    onChange={(event) =>
                      setMarksForm((prev) => ({
                        ...prev,
                        studentId: event.target.value,
                      }))
                    }
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  >
                    {students.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.name} · {student.email}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-sm font-medium text-slate-700 mb-1">Subject</span>
                  <select
                    value={marksForm.subjectId}
                    onChange={(event) =>
                      setMarksForm((prev) => ({
                        ...prev,
                        subjectId: event.target.value,
                      }))
                    }
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  >
                    {subjectOptions.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mb-6">
                <h4 className="text-base font-semibold text-slate-900 mb-4">Contest marks</h4>
                {currentSubjectContests.length ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {currentSubjectContests.map((contest) => (
                      <label key={contest.id} className="block">
                        <span className="block text-sm font-medium text-slate-700 mb-1">
                          {contest.title} <small className="text-slate-500">(Max {contest.maxScore})</small>
                        </span>
                        <input
                          type="number"
                          min="0"
                          max={contest.maxScore}
                          value={rawScores[marksForm.subjectId]?.[contest.id] ?? ""}
                          onChange={(event) =>
                            handleRawScoreChange(
                              marksForm.subjectId,
                              contest.id,
                              event.target.value
                            )
                          }
                          placeholder="Raw marks"
                          className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                        />
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="p-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-600 text-sm">
                    No contests available. Add contests under the "Contests" tab first.
                  </p>
                )}
              </div>

              <div className="mb-6">
                <label className="block">
                  <span className="block text-sm font-medium text-slate-700 mb-1">Mock interview score (out of 60)</span>
                  <input
                    type="number"
                    min="0"
                    max="60"
                    value={marksForm.mockScore}
                    onChange={(event) =>
                      setMarksForm((prev) => ({
                        ...prev,
                        mockScore: event.target.value,
                      }))
                    }
                    placeholder="55"
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </label>
              </div>

              <button
                type="submit"
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={loading.marksSave}
              >
                {loading.marksSave ? "Saving..." : "Update Vedam score"}
              </button>
            </form>

            {lastMeritResult && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8">
                <h3 className="text-lg font-semibold text-slate-900 mb-6">Latest merit score published</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  <article className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                    <h4 className="text-sm text-slate-600 mb-1">Normalized contests</h4>
                    <p className="text-xl font-semibold text-slate-900">
                      {lastMeritResult.contestNormalizedTotal} /{" "}
                      {lastMeritResult.contestMaxPossible}
                    </p>
                  </article>
                  <article className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                    <h4 className="text-sm text-slate-600 mb-1">Contest weight (40%)</h4>
                    <p className="text-xl font-semibold text-slate-900">{lastMeritResult.contestScaled40} / 40</p>
                  </article>
                  <article className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                    <h4 className="text-sm text-slate-600 mb-1">Mock interview</h4>
                    <p className="text-xl font-semibold text-slate-900">{lastMeritResult.mockScore} / 60</p>
                  </article>
                  <article className="bg-emerald-50 rounded-lg p-4 border border-emerald-200">
                    <h4 className="text-sm text-emerald-700 mb-1">Vedam subject total</h4>
                    <p className="text-xl font-semibold text-emerald-700">{lastMeritResult.total} / 100</p>
                  </article>
                </div>
                <div className="border-t border-slate-200 pt-6">
                  <h4 className="text-base font-semibold text-slate-900 mb-4">Contest breakdown</h4>
                  <ul className="space-y-2">
                    {lastMeritResult.contests?.map((contest) => (
                      <li key={contest.contestId} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-200">
                        <span className="text-sm font-medium text-slate-900">{contest.contestTitle || contest.contestId}</span>
                        <span className="text-sm text-slate-600">
                          Raw {contest.rawScore} / {contest.maxScore} → Normalized{" "}
                          {contest.normalizedScore}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default AdminPanel;

