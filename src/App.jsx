import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./firebase/config.js";
import Sidebar from "./components/Sidebar.jsx";
import Login from "./components/Login.jsx";
import AdminPanel from "./components/AdminPanel.jsx";
import JavaEditor from "./components/JavaEditor.jsx";
import {
  findStudentByEmail,
  listSubjects,
  listStudentSubjectScores,
  listStudentEvaluations,
  listPracticeTasks,
  getTopicAnalytics,
  createPracticeTask,
} from "./services/firestore.js";
import { generateHistoricalReport, generateHistoricalPracticeQuestions, generateMathsQuiz, generateWebQuiz, generateJavaQuiz } from "./services/cursorAI.js";
import { getCachedQuiz, setCachedQuiz } from "./services/cache.js";

const formatTimestamp = (value) => {
  if (!value) return "--";
  const date =
    value instanceof Date
      ? value
      : value?.seconds
      ? new Date(value.seconds * 1000)
      : typeof value === "string"
      ? new Date(value)
      : null;
  if (!date || Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const navItems = [
  { id: "dashboard", label: "Dashboard", tagline: "Today at a glance", icon: "DB" },
  { id: "subjects", label: "Subjects", tagline: "Deep dives & plans", icon: "SB" },
  { id: "java", label: "Java Editor", tagline: "Code & submit solutions", icon: "JE" },
  { id: "analytics", label: "Analytics & Report", tagline: "Progress pulse", icon: "AR" },
  { id: "profile", label: "Profile", tagline: "Personal preferences", icon: "PR" },
];

const sectionCopy = {
  dashboard: {
    eyebrow: "Vedam Dashboard",
    heading: "Contest Performance Overview",
    description:
      "Track normalized Vedam scores published by the admin and stay on top of eligibility milestones.",
  },
  subjects: {
    eyebrow: "Contest Subjects",
    heading: "Maths, Java & Web",
    description:
      "Review detailed contest breakdowns and identify which subjects need more attention.",
  },
  java: {
    eyebrow: "Java Coding",
    heading: "Contest Editor",
    description:
      "Write, test, and submit your Java solutions for contest questions.",
  },
  analytics: {
    eyebrow: "Performance Insights",
    heading: "Analytics & Report",
    description:
      "Dive into aggregated metrics, subject comparisons, and contest history generated from your Vedam data.",
  },
  profile: {
    eyebrow: "Student Profile",
    heading: "Profile & Settings",
    description:
      "View your Vedam student details, eligibility status, and refresh your published data.",
  },
};

const App = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(() =>
    sessionStorage.getItem("vedam_admin_session") === "true" ? "admin" : "student"
  );
  const [activeSection, setActiveSection] = useState(navItems[0].id);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [studentRecord, setStudentRecord] = useState(null);
  const [subjectsCatalog, setSubjectsCatalog] = useState([]);
  const [subjectScores, setSubjectScores] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState(null);
  const [dataNotice, setDataNotice] = useState(null);
  const [pendingStudent, setPendingStudent] = useState(null);
  const [historicalReport, setHistoricalReport] = useState(null);
  const [practiceTasks, setPracticeTasks] = useState([]);
  const [loadingReport, setLoadingReport] = useState(false);
  
  // Quiz State (Maths, Web & Java)
  const [mathsQuizModal, setMathsQuizModal] = useState(false);
  const [webQuizModal, setWebQuizModal] = useState(false);
  const [javaQuizModal, setJavaQuizModal] = useState(false);
  const [javaChoiceModal, setJavaChoiceModal] = useState(false);
  const [quizForm, setQuizForm] = useState({
    topic: "",
    difficulty: "medium",
    numQuestions: 10,
    quizType: "maths", // "maths", "web", or "java"
  });
  const [generatingQuiz, setGeneratingQuiz] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState(null);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizScore, setQuizScore] = useState(null);
  const [refreshingQuiz, setRefreshingQuiz] = useState(null); // Track which quiz is being refreshed
  const [profileImageError, setProfileImageError] = useState(false);

  const loadStudentData = useCallback(async () => {
    if (!user?.email) return;
    setDataLoading(true);
    setDataError(null);
    setDataNotice(null);
    try {
      const [subjects, student] = await Promise.all([
        listSubjects(),
        findStudentByEmail(user.email),
      ]);
      setSubjectsCatalog(subjects);

      if (!student) {
        setStudentRecord(null);
        setSubjectScores([]);
        setDataNotice(
          "You are signed in, but the admin has not registered you yet. Please contact your Vedam mentor."
        );
        return;
      }

      setStudentRecord(student);
      const scores = await listStudentSubjectScores(student.id);
      setSubjectScores(scores);
      if (!scores.length) {
        setDataNotice("No Vedam scores published yet. Check back soon.");
      }
    } catch (error) {
      console.error("Failed to load student data", {
        error: error.message,
        stack: error.stack,
        context: {
          userEmail: user?.email,
          hasUser: !!user,
          studentsLength: undefined // Will be logged separately
        }
      });
      setDataError(`Unable to load your latest data: ${error.message}. Please try refreshing.`);
    } finally {
      setDataLoading(false);
    }
  }, [user]);

  // Auth state listener
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      const evaluateUser = async () => {
        const allowedDomain = import.meta.env.VITE_ALLOWED_EMAIL_DOMAIN || "vedamsot.org";

        if (!currentUser) {
          if (cancelled) return;
          setUser(null);
          setPendingStudent(null);
          setStudentRecord(null);
          setSubjectsCatalog([]);
          setSubjectScores([]);
          setDataNotice(null);
          setDataError(null);
        setView((prev) =>
          prev === "admin" && sessionStorage.getItem("vedam_admin_session") === "true"
            ? "admin"
            : "student"
        );
          setLoading(false);
          return;
        }

        if (!currentUser.email || !currentUser.email.endsWith(`@${allowedDomain}`)) {
          await signOut(auth);
          if (cancelled) return;
          setUser(null);
          setPendingStudent(null);
          setLoading(false);
          return;
        }

        try {
          const existingStudent = await findStudentByEmail(currentUser.email);
          if (cancelled) return;

          if (existingStudent) {
            setPendingStudent(null);
            setStudentRecord(existingStudent);
            setUser(currentUser);
            setProfileImageError(false);
            setView("student");
          } else {
            setPendingStudent({
              email: currentUser.email,
              displayName: currentUser.displayName || "",
            });
            setUser(null);
            setStudentRecord(null);
            setSubjectsCatalog([]);
            setSubjectScores([]);
          }
        } catch (error) {
          console.error("Failed to verify student registration", error);
          if (cancelled) return;
          setUser(null);
          setPendingStudent(null);
          setDataError("Unable to verify your registration. Please try again.");
          setView("student");
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      };

      evaluateUser();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Sidebar responsive behavior
  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(min-width: 1024px)");
    const syncSidebar = () => setSidebarOpen(media.matches);
    syncSidebar();
    media.addEventListener("change", syncSidebar);
    return () => media.removeEventListener("change", syncSidebar);
  }, []);

  useEffect(() => {
    loadStudentData();
  }, [loadStudentData]);

  const subjectScoreMap = useMemo(
    () =>
      subjectScores.reduce((acc, score) => {
        if (score?.subjectId) {
          acc[score.subjectId] = score;
        }
        return acc;
      }, {}),
    [subjectScores]
  );

  const normalizedSubjects = useMemo(
    () =>
      subjectsCatalog.map((subject) => ({
        ...subject,
        score: subjectScoreMap[subject.id] || null,
      })),
    [subjectsCatalog, subjectScoreMap]
  );

  const subjectsWithScores = useMemo(
    () => normalizedSubjects.filter((subject) => Boolean(subject.score)),
    [normalizedSubjects]
  );

  const subjectsPending = useMemo(
    () => normalizedSubjects.filter((subject) => !subject.score),
    [normalizedSubjects]
  );

  const averageVedam = useMemo(() => {
    if (!subjectScores.length) return null;
    const total = subjectScores.reduce(
      (sum, score) => sum + (score.total ?? 0),
      0
    );
    return Number((total / subjectScores.length).toFixed(2));
  }, [subjectScores]);

  const contestTotals = useMemo(
    () =>
      subjectScores.reduce(
        (sum, score) => sum + (score.contests?.length ?? 0),
        0
      ),
    [subjectScores]
  );

  const averageMockScore = useMemo(() => {
    if (!subjectScores.length) return null;
    const total = subjectScores.reduce(
      (sum, score) => sum + (score.mockScore ?? 0),
      0
    );
    return Number((total / subjectScores.length).toFixed(2));
  }, [subjectScores]);

  const averageContestScaled = useMemo(() => {
    if (!subjectScores.length) return null;
    const total = subjectScores.reduce(
      (sum, score) => sum + (score.contestScaled40 ?? 0),
      0
    );
    return Number((total / subjectScores.length).toFixed(2));
  }, [subjectScores]);

  const highestSubject = useMemo(() => {
    if (!subjectsWithScores.length) return null;
    return subjectsWithScores.reduce((best, current) =>
      (current.score?.total ?? 0) > (best.score?.total ?? 0) ? current : best
    );
  }, [subjectsWithScores]);

  const lowestSubject = useMemo(() => {
    if (!subjectsWithScores.length) return null;
    return subjectsWithScores.reduce((worst, current) =>
      (current.score?.total ?? 0) < (worst.score?.total ?? 0) ? current : worst
    );
  }, [subjectsWithScores]);

  const innovationEligible = averageVedam !== null && averageVedam >= 60;
  const placementEligible = averageVedam !== null && averageVedam >= 75;

  const contestBreakdown = useMemo(
    () =>
      subjectsWithScores.flatMap((subject) =>
        (subject.score?.contests || []).map((contest) => ({
          subjectName: subject.name,
          ...contest,
        }))
      ),
    [subjectsWithScores]
  );

  const handleRefreshData = () => {
    if (!dataLoading) {
      loadStudentData();
    }
  };

  const loadHistoricalReport = useCallback(async () => {
    if (!studentRecord) return;
    
    setLoadingReport(true);
    try {
      console.log(`📊 loadHistoricalReport: Starting for student ${studentRecord?.id}`);
      
      const javaSubject = subjectsCatalog.find((s) => s?.name?.toLowerCase() === "java");
      if (!javaSubject) {
        console.warn("📊 loadHistoricalReport: Java subject not found in catalog");
        setLoadingReport(false);
        return;
      }

      console.log(`📋 loadHistoricalReport: Found Java subject ${javaSubject.id}, getting evaluations...`);
      
      const [evaluations, topicAnalytics] = await Promise.all([
        listStudentEvaluations(studentRecord.id, javaSubject.id),
        getTopicAnalytics(studentRecord.id, javaSubject.id)
      ]);
      
      console.log(`📊 loadHistoricalReport: Found ${evaluations.length} evaluations for historical report`);
      
      // Get practice tasks
      const allTasks = await listPracticeTasks(studentRecord.id, {
        subjectId: javaSubject.id,
      });
      setPracticeTasks(allTasks);

      // Check if current contest practice questions are completed
      const currentTasks = allTasks.filter((t) => t.questionType === "current");
      const completedCurrentTasks = currentTasks.filter((t) => t.status === "completed");
      
      // Generate random practice questions if current contest questions are completed
      if (currentTasks.length > 0 && completedCurrentTasks.length >= currentTasks.length * 0.8) {
        // 80% or more completed - generate random practice questions
        const existingHistorical = allTasks.filter((t) => t.questionType === "historical");
        if (existingHistorical.length === 0 && evaluations.length > 0) {
          // Generate random practice questions based on overall performance
          try {
            const randomQuestions = await generateHistoricalPracticeQuestions({
              studentAnalytics: topicAnalytics,
              pastEvaluations: evaluations,
              count: 5,
            });
            
            // Create practice tasks for random questions
            for (const practiceQ of randomQuestions) {
              await createPracticeTask({
                studentId: studentRecord.id,
                subjectId: javaSubject.id,
                task: {
                  questionType: "historical", // Random practice based on overall performance
                  ...practiceQ,
                },
              });
            }
            
            // Reload tasks
            const updatedTasks = await listPracticeTasks(studentRecord.id, {
              subjectId: javaSubject.id,
            });
            setPracticeTasks(updatedTasks);
          } catch (error) {
            console.error("Failed to generate random practice questions", error);
          }
        }
      }

      if (evaluations.length > 0) {
        const report = await generateHistoricalReport({
          allEvaluations: evaluations,
          topicAnalytics,
        });
        setHistoricalReport(report);
      }
    } catch (error) {
      console.error("Failed to load historical report", error);
      setDataError("Failed to load historical report.");
    } finally {
      setLoadingReport(false);
    }
  }, [studentRecord, subjectsCatalog]);

  useEffect(() => {
    if (activeSection === "analytics" && studentRecord) {
      loadHistoricalReport();
    }
  }, [activeSection, studentRecord, loadHistoricalReport]);

  const copy = useMemo(() => sectionCopy[activeSection] || sectionCopy.dashboard, [activeSection]);

  // Helper function to get subject-specific analytics
  const getSubjectAnalytics = useCallback((subjectName) => {
    const subject = normalizedSubjects.find(
      (s) => s?.name?.toLowerCase() === subjectName.toLowerCase()
    );
    
    if (!subject || !subject.score || !subject.score.contests) {
      return {
        contests: [],
        totalContests: 0,
        averageMarks: 0,
        averageAccuracy: 0,
      };
    }

    const contests = subject.score.contests || [];
    
    // Get last 3 contests (most recent first)
    const last3Contests = [...contests]
      .sort((a, b) => {
        // Sort by date if available, otherwise by order
        const dateA = a.date || a.updatedAt || 0;
        const dateB = b.date || b.updatedAt || 0;
        return new Date(dateB) - new Date(dateA);
      })
      .slice(0, 3);

    // Calculate average marks
    const totalMarks = contests.reduce((sum, c) => sum + (c.rawScore || 0), 0);
    const averageMarks = contests.length > 0 
      ? Number((totalMarks / contests.length).toFixed(2))
      : 0;

    // Calculate average accuracy (percentage)
    const totalAccuracy = contests.reduce((sum, c) => {
      if (c.maxScore && c.maxScore > 0) {
        return sum + ((c.rawScore || 0) / c.maxScore) * 100;
      }
      return sum;
    }, 0);
    const averageAccuracy = contests.length > 0
      ? Number((totalAccuracy / contests.length).toFixed(2))
      : 0;

    return {
      contests: last3Contests,
      totalContests: contests.length,
      averageMarks,
      averageAccuracy,
      subjectName: subject.name,
    };
  }, [normalizedSubjects]);

  const mathsAnalytics = useMemo(() => getSubjectAnalytics("Maths"), [getSubjectAnalytics]);
  const javaAnalytics = useMemo(() => getSubjectAnalytics("Java"), [getSubjectAnalytics]);
  const webAnalytics = useMemo(() => getSubjectAnalytics("Web"), [getSubjectAnalytics]);

  const handleAuthSuccess = (authenticatedUser) => {
    if (!authenticatedUser) return;
    setPendingStudent(null);
    setUser(authenticatedUser);
    setActiveSection(navItems[0].id);
    setDataNotice(null);
    setDataError(null);
    setView("student");
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setStudentRecord(null);
      setSubjectsCatalog([]);
      setSubjectScores([]);
      setPendingStudent(null);
      setDataNotice(null);
      setDataError(null);
      setActiveSection(navItems[0].id);
      setView("student");
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  if (view === "admin") {
    return (
      <AdminPanel
        onExit={() => {
          sessionStorage.removeItem("vedam_admin_session");
          setView("student");
        }}
      />
    );
  }

  // Show loading state
  if (loading) {
    return (
      <div className="app-layout" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ textAlign: "center" }}>
          <div className="login-spinner" style={{ margin: "0 auto 1rem" }}></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  // Show login if not authenticated
  if (!user) {
    return (
      <Login
        onAuthSuccess={handleAuthSuccess}
        pendingStudent={pendingStudent}
        onAdminAccess={() => setView("admin")}
      />
    );
  }

  const handleNavSelect = (sectionId) => {
    setActiveSection(sectionId);
    if (typeof window !== "undefined") {
      const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
      if (!isDesktop) setSidebarOpen(false);
    }
  };

  // Quiz Handlers (Maths, Web & Java)
  const handleMathsCardClick = () => {
    setWebQuizModal(false);
    setJavaQuizModal(false);
    setJavaChoiceModal(false);
    setQuizAnswers({});
    setQuizSubmitted(false);
    setQuizScore(null);
    
    // Check cache first - if exists, show quiz directly
    const cached = getCachedQuiz('maths');
    if (cached && cached.questions) {
      setQuizQuestions(cached.questions);
      setQuizForm({
        topic: cached.params.topic || "",
        difficulty: cached.params.difficulty || "medium",
        numQuestions: cached.params.numQuestions || 10,
        quizType: "maths",
      });
      setMathsQuizModal(false); // Don't show modal
    } else {
      // No cache - show modal to generate quiz
      setMathsQuizModal(true);
      setQuizQuestions(null);
      setQuizForm({
        topic: "",
        difficulty: "medium",
        numQuestions: 10,
        quizType: "maths",
      });
    }
  };

  const handleWebCardClick = () => {
    setMathsQuizModal(false);
    setJavaQuizModal(false);
    setJavaChoiceModal(false);
    setQuizAnswers({});
    setQuizSubmitted(false);
    setQuizScore(null);
    
    // Check cache first - if exists, show quiz directly
    const cached = getCachedQuiz('web');
    if (cached && cached.questions) {
      setQuizQuestions(cached.questions);
      setQuizForm({
        topic: cached.params.topic || "",
        difficulty: cached.params.difficulty || "medium",
        numQuestions: cached.params.numQuestions || 10,
        quizType: "web",
      });
      setWebQuizModal(false); // Don't show modal
    } else {
      // No cache - show modal to generate quiz
      setWebQuizModal(true);
      setQuizQuestions(null);
      setQuizForm({
        topic: "",
        difficulty: "medium",
        numQuestions: 10,
        quizType: "web",
      });
    }
  };

  // Java Card Handler - Shows choice modal
  const handleJavaCardClick = () => {
    setJavaChoiceModal(true);
    setMathsQuizModal(false);
    setWebQuizModal(false);
    setJavaQuizModal(false);
  };

  // Java Coding Option - Navigate to Java Editor
  const handleJavaCoding = () => {
    setJavaChoiceModal(false);
    handleNavSelect("java");
  };

  // Java Quiz Option - Open quiz modal
  const handleJavaQuizClick = () => {
    setJavaChoiceModal(false);
    setMathsQuizModal(false);
    setWebQuizModal(false);
    setQuizAnswers({});
    setQuizSubmitted(false);
    setQuizScore(null);
    
    // Check cache first - if exists, show quiz directly
    const cached = getCachedQuiz('java');
    if (cached && cached.questions) {
      setQuizQuestions(cached.questions);
      setQuizForm({
        topic: cached.params.topic || "",
        difficulty: cached.params.difficulty || "medium",
        numQuestions: cached.params.numQuestions || 10,
        quizType: "java",
      });
      setJavaQuizModal(false); // Don't show modal
    } else {
      // No cache - show modal to generate quiz
      setJavaQuizModal(true);
      setQuizQuestions(null);
      setQuizForm({
        topic: "",
        difficulty: "medium",
        numQuestions: 10,
        quizType: "java",
      });
    }
  };

  const handleGenerateQuiz = async (forceRefresh = false) => {
    if (!quizForm.topic.trim()) {
      const subjectName = quizForm.quizType === "maths" ? "maths" 
        : quizForm.quizType === "web" ? "web development" 
        : "Java programming";
      alert(`Please enter a ${subjectName} topic`);
      return;
    }

    // Check cache first if not forcing refresh
    if (!forceRefresh) {
      const cached = getCachedQuiz(quizForm.quizType);
      if (cached && 
          cached.params.topic === quizForm.topic.trim() &&
          cached.params.difficulty === quizForm.difficulty &&
          cached.params.numQuestions === quizForm.numQuestions) {
        setQuizQuestions(cached.questions);
        setMathsQuizModal(false);
        setWebQuizModal(false);
        setJavaQuizModal(false);
        return;
      }
    }

    setGeneratingQuiz(true);
    try {
      let questions;
      if (quizForm.quizType === "maths") {
        questions = await generateMathsQuiz({
          topic: quizForm.topic.trim(),
          difficulty: quizForm.difficulty,
          numQuestions: quizForm.numQuestions,
        });
      } else if (quizForm.quizType === "web") {
        questions = await generateWebQuiz({
          topic: quizForm.topic.trim(),
          difficulty: quizForm.difficulty,
          numQuestions: quizForm.numQuestions,
        });
      } else { // java
        questions = await generateJavaQuiz({
          topic: quizForm.topic.trim(),
          difficulty: quizForm.difficulty,
          numQuestions: quizForm.numQuestions,
        });
      }
      
      // Cache the generated quiz
      setCachedQuiz(quizForm.quizType, {
        questions,
        params: {
          topic: quizForm.topic.trim(),
          difficulty: quizForm.difficulty,
          numQuestions: quizForm.numQuestions,
        },
      });
      
      setQuizQuestions(questions);
      setMathsQuizModal(false);
      setWebQuizModal(false);
      setJavaQuizModal(false);
    } catch (error) {
      console.error("Failed to generate quiz", error);
      alert(`Failed to generate quiz: ${error.message}`);
    } finally {
      setGeneratingQuiz(false);
      setRefreshingQuiz(null);
    }
  };

  // Handle refresh button click for quiz cards
  const handleRefreshQuiz = (quizType, e) => {
    if (e) {
      e.stopPropagation(); // Prevent opening modal from card click
    }
    
    // Set the quiz form type
    setQuizForm(prev => ({
      ...prev,
      quizType,
    }));
    
    // Get cached params to pre-fill form, or use defaults
    const cached = getCachedQuiz(quizType);
    if (cached) {
      setQuizForm(prev => ({
        ...prev,
        topic: cached.params.topic || "",
        difficulty: cached.params.difficulty || "medium",
        numQuestions: cached.params.numQuestions || 10,
        quizType,
      }));
    } else {
      setQuizForm(prev => ({
        ...prev,
        topic: "",
        difficulty: "medium",
        numQuestions: 10,
        quizType,
      }));
    }
    
    // Open appropriate modal to ask for topic, difficulty, and numQuestions
    if (quizType === "maths") {
      setMathsQuizModal(true);
      setWebQuizModal(false);
      setJavaQuizModal(false);
    } else if (quizType === "web") {
      setWebQuizModal(true);
      setMathsQuizModal(false);
      setJavaQuizModal(false);
    } else {
      setJavaQuizModal(true);
      setMathsQuizModal(false);
      setWebQuizModal(false);
    }
  };

  const handleAnswerSelect = (questionId, answer) => {
    setQuizAnswers(prev => ({ ...prev, [questionId]: answer }));
  };

  const handleSubmitQuiz = () => {
    if (!quizQuestions) return;
    
    let correct = 0;
    quizQuestions.forEach(q => {
      if (quizAnswers[q.id] === q.correctAnswer) {
        correct++;
      }
    });
    
    const score = Math.round((correct / quizQuestions.length) * 100);
    setQuizScore({ correct, total: quizQuestions.length, percentage: score });
    setQuizSubmitted(true);
  };

  const renderDashboard = () => {
    const cards = [
      {
        title: "Average Vedam Score",
        value:
          averageVedam !== null ? `${averageVedam} / 100` : "Awaiting data",
        helper: subjectScores.length
          ? `Across ${subjectScores.length} subject${
              subjectScores.length > 1 ? "s" : ""
            }`
          : "Scores will appear once published by the admin.",
      },
      {
        title: "Innovation Lab Access",
        value:
          averageVedam !== null
            ? innovationEligible
              ? "Eligible"
              : "Not yet"
            : "Pending",
        helper:
          averageVedam !== null
            ? innovationEligible
              ? "Great job! Keep the momentum."
              : `${Math.max(
                  0,
                  Number((60 - averageVedam).toFixed(2))
                )} points needed to reach 60.`
            : "Requires an average of 60 or above.",
      },
      {
        title: "Placement Eligibility",
        value:
          averageVedam !== null
            ? placementEligible
              ? "Eligible"
              : "Not yet"
            : "Pending",
        helper:
          averageVedam !== null
            ? placementEligible
              ? "You meet the ≥75 threshold."
              : `${Math.max(
                  0,
                  Number((75 - averageVedam).toFixed(2))
                )} more points needed.`
            : "Requires an average of 75 or above.",
      },
      {
        title: "Subjects Tracked",
        value: `${subjectsWithScores.length}/${
          normalizedSubjects.length || "—"
        }`,
        helper:
          normalizedSubjects.length && subjectsPending.length
            ? `${subjectsPending.length} subject${
                subjectsPending.length > 1 ? "s" : ""
              } awaiting scores.`
            : "All configured subjects are up to date.",
      },
    ];

    return (
      <>
        {(dataError || dataNotice) && (
          <div
            className={`rounded-lg p-4 text-sm font-medium mb-6 ${
              dataError
                ? "bg-red-50 text-red-700 border border-red-200"
                : "bg-emerald-50 text-emerald-700 border border-emerald-200"
            }`}
            role="status"
          >
            {dataError || dataNotice}
          </div>
        )}

        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8">
          <div className="flex justify-between items-start gap-4 flex-wrap mb-6">
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">Vedam overview</p>
              <h2 className="text-xl font-bold text-slate-900">Progress snapshot</h2>
            </div>
            <button
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
              onClick={handleRefreshData}
              disabled={dataLoading}
            >
              {dataLoading ? "Refreshing..." : "Refresh data"}
            </button>
          </div>
          {dataLoading && !subjectScores.length ? (
            <div className="p-4 rounded-lg border border-dashed border-slate-300 bg-white text-slate-600 text-sm">
              Loading Vedam snapshot…
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {cards.map((card) => (
                <article key={card.title} className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <p className="text-sm text-slate-600 mb-1">{card.title}</p>
                  <p className="text-2xl font-semibold text-slate-900 mb-1">{card.value}</p>
                  <p className="text-xs text-slate-500">{card.helper}</p>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Subject highlights</h3>
            <p className="text-sm text-slate-600 mb-4">
              {subjectsWithScores.length
                ? "Your strongest and focus subjects are based on the latest published totals."
                : "Once scores are published, your strongest and focus subjects will be displayed here."}
            </p>
            <ul className="space-y-4">
              <li className="grid grid-cols-[80px_1fr] gap-4">
                <span className="font-semibold text-emerald-700">Top</span>
                <div>
                  {highestSubject ? (
                    <>
                      <div className="font-medium text-slate-900">{highestSubject.name}</div>
                      <p className="text-sm text-slate-600 mt-1">
                        {highestSubject.score.total} / 100 · Updated{" "}
                        {formatTimestamp(highestSubject.score.updatedAt)}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-slate-600">Waiting for contest data.</p>
                  )}
                </div>
              </li>
              <li className="grid grid-cols-[80px_1fr] gap-4">
                <span className="font-semibold text-emerald-700">Focus</span>
                <div>
                  {lowestSubject ? (
                    <>
                      <div className="font-medium text-slate-900">{lowestSubject.name}</div>
                      <p className="text-sm text-slate-600 mt-1">
                        {lowestSubject.score.total} / 100 · Updated{" "}
                        {formatTimestamp(lowestSubject.score.updatedAt)}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-slate-600">Nothing flagged yet.</p>
                  )}
                </div>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Contest activity</h3>
            <p className="text-sm text-slate-600 mb-4">
              {contestTotals
                ? `You currently have ${contestTotals} contest ${
                    contestTotals === 1 ? "entry" : "entries"
                  } recorded and normalized.`
                : "Contests will appear here after the admin publishes scores."}
            </p>
            {contestTotals ? (
              <div className="grid grid-cols-1 gap-4">
                <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <div className="text-2xl font-bold text-slate-900 mb-1">{contestTotals}</div>
                  <span className="text-sm text-slate-600">Contests recorded</span>
                </div>
                <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <div className="text-2xl font-bold text-slate-900 mb-1">
                    {averageContestScaled !== null
                      ? `${averageContestScaled} / 40`
                      : "—"}
                  </div>
                  <span className="text-sm text-slate-600">Average contest weight</span>
                </div>
                <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <div className="text-2xl font-bold text-slate-900 mb-1">
                    {averageMockScore !== null
                      ? `${averageMockScore} / 60`
                      : "—"}
                  </div>
                  <span className="text-sm text-slate-600">Average mock score</span>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-lg border border-dashed border-slate-300 bg-white text-slate-600 text-sm">
                Publish contest scores to see activity here.
              </div>
            )}
          </div>
        </section>
      </>
    );
  };

  const renderSubjects = () => (
    <>
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8">
      <div className="flex justify-between items-start gap-4 flex-wrap mb-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">Subject breakdown</p>
          <h2 className="text-xl font-bold text-slate-900">Vedam merit progress</h2>
        </div>
        <button
          className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          type="button"
          onClick={handleRefreshData}
          disabled={dataLoading}
        >
          {dataLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      {dataLoading && !normalizedSubjects.length ? (
        <div className="p-4 rounded-lg border border-dashed border-slate-300 bg-white text-slate-600 text-sm">
          Loading subject details…
        </div>
      ) : normalizedSubjects.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {normalizedSubjects.map((subject) => {
            const score = subject.score;
            return (
              <article key={subject.id} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                <header>
                  <h3 className="text-lg font-semibold text-slate-900 mb-1">{subject.name}</h3>
                  <p className="text-sm text-slate-600">{subject.description || "Contest track details"}</p>
                </header>
                {score ? (
                  <>
                    <div className="w-full h-2 rounded-full bg-slate-200 relative overflow-hidden">
                      <div
                        className="absolute top-0 left-0 h-full bg-emerald-600 rounded-full"
                        style={{ width: `${Math.min(score.total, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="font-medium text-slate-900">{score.total} / 100</span>
                      <span className="text-slate-600">Updated {formatTimestamp(score.updatedAt)}</span>
                    </div>
                    <ul className="space-y-2">
                      {score.contests?.length ? (
                        score.contests.map((contest) => (
                          <li key={contest.contestId} className="flex justify-between items-start gap-4 text-sm">
                            <div>
                              <strong className="text-slate-900 block">{contest.contestTitle || "Contest"}</strong>
                              <small className="text-slate-500 block mt-0.5">
                                Raw {contest.rawScore} / {contest.maxScore}
                              </small>
                            </div>
                            <span className="text-slate-700 font-medium">{contest.normalizedScore} / 50</span>
                          </li>
                        ))
                      ) : (
                        <li className="text-sm text-slate-600">No contests recorded yet.</li>
                      )}
                    </ul>
                  </>
                ) : (
                  <p className="text-sm text-slate-600">
                    Awaiting admin update for this subject.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-slate-600">
          No Vedam subjects configured yet. Please contact your admin.
        </p>
      )}
    </section>

    {/* Practice Questions Section */}
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8 mt-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">Practice Questions</p>
        <h2 className="text-xl font-bold text-slate-900">Subject Practice Areas</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Maths Card */}
        <div 
          onClick={handleMathsCardClick}
          className="practice-subject-card practice-subject-card--maths"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="practice-subject-icon practice-subject-icon--maths">
                <span className="text-2xl font-bold text-blue-600">M</span>
              </div>
              <h4 className="text-lg font-semibold text-slate-900">Maths</h4>
            </div>
            <button
              onClick={(e) => handleRefreshQuiz('maths', e)}
              disabled={refreshingQuiz === 'maths'}
              className="practice-subject-card__refresh-btn"
              title="Refresh quiz"
            >
              {refreshingQuiz === 'maths' ? (
                <span className="animate-spin">⏳</span>
              ) : (
                <span>🔄</span>
              )}
            </button>
          </div>
          <p className="text-sm text-slate-600">Click to generate quiz</p>
        </div>

        {/* Java Card */}
        <div 
          onClick={handleJavaCardClick}
          className="practice-subject-card practice-subject-card--java"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="practice-subject-icon practice-subject-icon--java">
                <span className="text-2xl font-bold text-emerald-600">J</span>
              </div>
              <h4 className="text-lg font-semibold text-slate-900">Java</h4>
            </div>
            <button
              onClick={(e) => handleRefreshQuiz('java', e)}
              disabled={refreshingQuiz === 'java'}
              className="practice-subject-card__refresh-btn"
              title="Refresh quiz"
            >
              {refreshingQuiz === 'java' ? (
                <span className="animate-spin">⏳</span>
              ) : (
                <span>🔄</span>
              )}
            </button>
          </div>
          <p className="text-sm text-slate-600">Click to choose option</p>
        </div>

        {/* Web Card */}
        <div 
          onClick={handleWebCardClick}
          className="practice-subject-card practice-subject-card--web"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="practice-subject-icon practice-subject-icon--web">
                <span className="text-2xl font-bold text-slate-600">W</span>
              </div>
              <h4 className="text-lg font-semibold text-slate-900">Web</h4>
            </div>
            <button
              onClick={(e) => handleRefreshQuiz('web', e)}
              disabled={refreshingQuiz === 'web'}
              className="practice-subject-card__refresh-btn"
              title="Refresh quiz"
            >
              {refreshingQuiz === 'web' ? (
                <span className="animate-spin">⏳</span>
              ) : (
                <span>🔄</span>
              )}
            </button>
          </div>
          <p className="text-sm text-slate-600">Click to generate quiz</p>
        </div>
      </div>
    </section>

    {/* Java Choice Modal */}
    {javaChoiceModal && (
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="quiz-modal-container">
          <div className="quiz-modal-header">
            <h3 className="quiz-modal-title">Choose Java Option</h3>
            <button
              onClick={() => setJavaChoiceModal(false)}
              className="quiz-modal-close"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          
          <div className="quiz-modal-content">
            <div className="java-choice-options">
              <button
                onClick={handleJavaCoding}
                className="java-choice-btn java-choice-btn--coding"
              >
                <div className="java-choice-icon">💻</div>
                <div className="java-choice-content">
                  <h4 className="java-choice-title">Coding</h4>
                  <p className="java-choice-desc">Practice coding with Java Editor</p>
                </div>
                <div className="java-choice-arrow">→</div>
              </button>
              
              <button
                onClick={handleJavaQuizClick}
                className="java-choice-btn java-choice-btn--quiz"
              >
                <div className="java-choice-icon">📝</div>
                <div className="java-choice-content">
                  <h4 className="java-choice-title">Quiz</h4>
                  <p className="java-choice-desc">Test your Java knowledge</p>
                </div>
                <div className="java-choice-arrow">→</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    )}

    {/* Quiz Generation Modal (Maths, Web & Java) */}
    {(mathsQuizModal || webQuizModal || javaQuizModal) && (
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="quiz-modal-container">
          <div className="quiz-modal-header">
            <h3 className="quiz-modal-title">
              Generate {
                quizForm.quizType === "maths" ? "Maths" 
                : quizForm.quizType === "web" ? "Web Development" 
                : "Java Programming"
              } Quiz
            </h3>
            <button
              onClick={() => {
                setMathsQuizModal(false);
                setWebQuizModal(false);
                setJavaQuizModal(false);
              }}
              className="quiz-modal-close"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          
          <div className="quiz-modal-content">
            <div className="quiz-form-group">
              <label className="quiz-form-label">
                Topic <span className="text-red-500">*</span>
              </label>
              <textarea
                value={quizForm.topic}
                onChange={(e) => setQuizForm(prev => ({ ...prev, topic: e.target.value }))}
                placeholder={
                  quizForm.quizType === "maths" 
                    ? "e.g., Algebra, Calculus, Geometry, Trigonometry, Statistics..."
                    : quizForm.quizType === "web"
                    ? "e.g., HTML, CSS, JavaScript, React, Node.js, TypeScript..."
                    : "e.g., OOP, Collections, Multithreading, Streams, Spring, JVM..."
                }
                className="quiz-form-textarea"
                rows="3"
              />
            </div>

            <div className="quiz-form-group">
              <label className="quiz-form-label">
                Difficulty
              </label>
              <select
                value={quizForm.difficulty}
                onChange={(e) => setQuizForm(prev => ({ ...prev, difficulty: e.target.value }))}
                className="quiz-form-select"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>

            <div className="quiz-form-group">
              <label className="quiz-form-label">
                Number of Questions: <span className="quiz-form-value">{quizForm.numQuestions}</span>
              </label>
              <input
                type="range"
                min="5"
                max="10"
                value={quizForm.numQuestions}
                onChange={(e) => setQuizForm(prev => ({ ...prev, numQuestions: parseInt(e.target.value) }))}
                className="quiz-form-slider"
              />
              <div className="quiz-form-slider-labels">
                <span>5</span>
                <span>10</span>
              </div>
            </div>

            <button
              onClick={handleGenerateQuiz}
              disabled={generatingQuiz || !quizForm.topic.trim()}
              className="quiz-form-submit"
            >
              {generatingQuiz ? (
                <>
                  <span className="animate-spin">⏳</span>
                  Generating Quiz...
                </>
              ) : (
                "Generate Quiz"
              )}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Quiz Display */}
    {quizQuestions && (
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8 mt-6">
        {!quizSubmitted ? (
          <>
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  {
                    quizForm.quizType === "maths" ? "Maths" 
                    : quizForm.quizType === "web" ? "Web Development" 
                    : "Java Programming"
                  } Quiz: {quizForm.topic}
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  {quizForm.difficulty.charAt(0).toUpperCase() + quizForm.difficulty.slice(1)} • {quizQuestions.length} questions
                </p>
              </div>
            </div>

            <div className="space-y-6">
              {quizQuestions.map((q, index) => {
                const userAnswer = quizAnswers[q.id];
                return (
                  <div key={q.id} className="quiz-question-card">
                    <div className="flex items-start gap-3">
                      <span className="quiz-question-number">{index + 1}</span>
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-slate-900 mb-4">{q.question}</h3>
                        <div className="space-y-2">
                          {Object.entries(q.options).map(([option, text]) => {
                            const isSelected = userAnswer === option;
                            return (
                              <label 
                                key={option} 
                                className={`quiz-option ${isSelected ? 'quiz-option-selected' : ''}`}
                              >
                                <input
                                  type="radio"
                                  name={`question-${q.id}`}
                                  value={option}
                                  checked={isSelected}
                                  onChange={() => handleAnswerSelect(q.id, option)}
                                  className="quiz-radio"
                                />
                                <span className="quiz-option-label">{option}. {text}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-8 flex justify-end">
              <button
                onClick={handleSubmitQuiz}
                disabled={Object.keys(quizAnswers).length !== quizQuestions.length}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-3 px-8 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Submit Quiz
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Results Summary Card */}
            <div className="quiz-results-summary">
              <div className="quiz-results-header">
                <h2 className="text-2xl font-bold text-slate-900">Quiz Results</h2>
                <p className="text-sm text-slate-600 mt-1">Topic: {quizForm.topic}</p>
              </div>
              
              <div className="quiz-results-stats">
                <div className="quiz-stat-card quiz-stat-card--score">
                  <div className="quiz-stat-value">{quizScore.percentage}%</div>
                  <div className="quiz-stat-label">Accuracy</div>
                </div>
                <div className="quiz-stat-card quiz-stat-card--marks">
                  <div className="quiz-stat-value">{quizScore.correct}/{quizScore.total}</div>
                  <div className="quiz-stat-label">Marks</div>
                </div>
              </div>

              {quizScore.percentage >= 80 && (
                <div className="quiz-success-message">
                  🎉 Excellent work! You have a strong understanding of this topic.
                </div>
              )}
              {quizScore.percentage >= 60 && quizScore.percentage < 80 && (
                <div className="quiz-good-message">
                  👍 Good job! Keep practicing to improve further.
                </div>
              )}
              {quizScore.percentage < 60 && (
                <div className="quiz-improve-message">
                  💪 Keep practicing! Review the explanations below to strengthen your understanding.
                </div>
              )}
            </div>

            {/* Questions with answers */}
            <div className="space-y-6 mt-8">
              {quizQuestions.map((q, index) => {
                const userAnswer = quizAnswers[q.id];
                return (
                  <div key={q.id} className="quiz-question-card">
                    <div className="flex items-start gap-3">
                      <span className="quiz-question-number">{index + 1}</span>
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-slate-900 mb-4">{q.question}</h3>
                        <div className="space-y-2">
                          {Object.entries(q.options).map(([option, text]) => {
                            const isSelected = userAnswer === option;
                            const isCorrect = option === q.correctAnswer;
                            let optionClass = "quiz-option";

                            if (isCorrect) {
                              optionClass += " quiz-option-correct";
                            } else if (isSelected && !isCorrect) {
                              optionClass += " quiz-option-incorrect";
                            }

                            return (
                              <label key={option} className={optionClass}>
                                <input
                                  type="radio"
                                  name={`question-${q.id}`}
                                  value={option}
                                  checked={isSelected}
                                  onChange={() => {}}
                                  disabled
                                  className="quiz-radio"
                                />
                                <span className="quiz-option-label">{option}. {text}</span>
                                {isCorrect && (
                                  <span className="quiz-correct-badge">✓ Correct</span>
                                )}
                                {isSelected && !isCorrect && (
                                  <span className="quiz-incorrect-badge">✗ Your Answer</span>
                                )}
                              </label>
                            );
                          })}
                        </div>
                        {q.explanation && (
                          <div className="quiz-explanation">
                            <strong>Explanation:</strong> {q.explanation}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-8 text-center">
              <button
                onClick={() => {
                  setQuizQuestions(null);
                  setQuizAnswers({});
                  setQuizSubmitted(false);
                  setQuizScore(null);
                  if (quizForm.quizType === "maths") {
                    setMathsQuizModal(true);
                  } else if (quizForm.quizType === "web") {
                    setWebQuizModal(true);
                  } else {
                    setJavaQuizModal(true);
                  }
                }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-3 px-8 rounded-lg transition-colors"
              >
                Generate New Quiz
              </button>
            </div>
          </>
        )}
      </section>
    )}
    </>
  );

  const analyticsCards = [
    {
      label: "Subjects with scores",
      value: subjectsWithScores.length,
      trendLabel: normalizedSubjects.length
        ? `of ${normalizedSubjects.length} subjects`
        : "Subjects load automatically",
    },
    {
      label: "Contests recorded",
      value: contestTotals,
      trendLabel: contestTotals
        ? "Normalized to 50 per contest"
        : "No contests published yet",
    },
    {
      label: "Average mock score",
      value:
        averageMockScore !== null ? `${averageMockScore} / 60` : "Awaiting data",
      trendLabel: subjectsWithScores.length
        ? "Across published subjects"
        : "Pending contest results",
    },
  ];

  const renderAnalytics = () => (
    <>
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8">
        <div className="flex justify-between items-start gap-4 flex-wrap mb-6">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">Performance metrics</p>
            <h2 className="text-xl font-bold text-slate-900">Contest analytics</h2>
          </div>
          <button
            className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            type="button"
            onClick={handleRefreshData}
            disabled={dataLoading}
          >
            {dataLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        {dataLoading && !subjectScores.length ? (
          <div className="p-4 rounded-lg border border-dashed border-slate-300 bg-white text-slate-600 text-sm">
            Loading analytics…
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {analyticsCards.map((stat) => (
              <article key={stat.label} className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                <p className="text-sm text-slate-600 mb-1">{stat.label}</p>
                <p className="text-2xl font-semibold text-slate-900 mb-1">{stat.value}</p>
                <p className="text-xs text-slate-500">{stat.trendLabel}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Subject-Specific Analytics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10 mt-8">
        {/* Maths Analytics */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8">
          <div className="mb-6">
            <h3 className="text-lg font-bold text-slate-900 mb-1">Maths</h3>
            <p className="text-xs text-slate-500">Subject Performance</p>
          </div>
          
          {mathsAnalytics.totalContests > 0 ? (
            <>
              {/* Summary Stats */}
              <div className="flex flex-row gap-3 mb-6">
                <div className="flex-1 bg-slate-50 rounded-lg p-4 border border-slate-200 min-w-0">
                  <p className="text-xs text-slate-600 mb-1.5">Total</p>
                  <p className="text-lg font-semibold text-slate-900">{mathsAnalytics.totalContests}</p>
                </div>
                <div className="flex-1 bg-slate-50 rounded-lg p-4 border border-slate-200 min-w-0">
                  <p className="text-xs text-slate-600 mb-1.5">Avg Marks</p>
                  <p className="text-lg font-semibold text-slate-900">{mathsAnalytics.averageMarks.toFixed(1)}</p>
                </div>
                <div className="flex-1 bg-slate-50 rounded-lg p-4 border border-slate-200 min-w-0">
                  <p className="text-xs text-slate-600 mb-1.5">Avg Accuracy</p>
                  <p className="text-lg font-semibold text-slate-900">{mathsAnalytics.averageAccuracy.toFixed(1)}%</p>
                </div>
              </div>

              {/* Last 3 Contests Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-3 px-3 font-semibold text-slate-700">Contest</th>
                      <th className="text-left py-3 px-3 font-semibold text-slate-700">Date</th>
                      <th className="text-right py-3 px-3 font-semibold text-slate-700">Marks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mathsAnalytics.contests.map((contest, idx) => (
                      <tr key={contest.contestId || idx} className="border-b border-slate-100">
                        <td className="py-3 px-3 text-slate-900">
                          {contest.contestTitle || "Contest"}
                        </td>
                        <td className="py-3 px-3 text-slate-600">
                          {formatTimestamp(contest.date || contest.updatedAt)}
                        </td>
                        <td className="py-3 px-3 text-right font-medium text-slate-900">
                          {contest.rawScore || 0} / {contest.maxScore || 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="p-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-600 text-sm text-center">
              No contests recorded yet
            </div>
          )}
        </section>

        {/* Java Analytics */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8">
          <div className="mb-6">
            <h3 className="text-lg font-bold text-slate-900 mb-1">Java</h3>
            <p className="text-xs text-slate-500">Subject Performance</p>
          </div>
          
          {javaAnalytics.totalContests > 0 ? (
            <>
              {/* Summary Stats */}
              <div className="flex flex-row gap-3 mb-6">
                <div className="flex-1 bg-slate-50 rounded-lg p-4 border border-slate-200 min-w-0">
                  <p className="text-xs text-slate-600 mb-1.5">Total</p>
                  <p className="text-lg font-semibold text-slate-900">{javaAnalytics.totalContests}</p>
                </div>
                <div className="flex-1 bg-slate-50 rounded-lg p-4 border border-slate-200 min-w-0">
                  <p className="text-xs text-slate-600 mb-1.5">Avg Marks</p>
                  <p className="text-lg font-semibold text-slate-900">{javaAnalytics.averageMarks.toFixed(1)}</p>
                </div>
                <div className="flex-1 bg-slate-50 rounded-lg p-4 border border-slate-200 min-w-0">
                  <p className="text-xs text-slate-600 mb-1.5">Avg Accuracy</p>
                  <p className="text-lg font-semibold text-slate-900">{javaAnalytics.averageAccuracy.toFixed(1)}%</p>
                </div>
              </div>

              {/* Last 3 Contests Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-3 px-3 font-semibold text-slate-700">Contest</th>
                      <th className="text-left py-3 px-3 font-semibold text-slate-700">Date</th>
                      <th className="text-right py-3 px-3 font-semibold text-slate-700">Marks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {javaAnalytics.contests.map((contest, idx) => (
                      <tr key={contest.contestId || idx} className="border-b border-slate-100">
                        <td className="py-3 px-3 text-slate-900">
                          {contest.contestTitle || "Contest"}
                        </td>
                        <td className="py-3 px-3 text-slate-600">
                          {formatTimestamp(contest.date || contest.updatedAt)}
                        </td>
                        <td className="py-3 px-3 text-right font-medium text-slate-900">
                          {contest.rawScore || 0} / {contest.maxScore || 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="p-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-600 text-sm text-center">
              No contests recorded yet
            </div>
          )}
        </section>

        {/* Web Dev Analytics */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8">
          <div className="mb-6">
            <h3 className="text-lg font-bold text-slate-900 mb-1">Web Dev</h3>
            <p className="text-xs text-slate-500">Subject Performance</p>
          </div>
          
          {webAnalytics.totalContests > 0 ? (
            <>
              {/* Summary Stats */}
              <div className="flex flex-row gap-3 mb-6">
                <div className="flex-1 bg-slate-50 rounded-lg p-4 border border-slate-200 min-w-0">
                  <p className="text-xs text-slate-600 mb-1.5">Total</p>
                  <p className="text-lg font-semibold text-slate-900">{webAnalytics.totalContests}</p>
                </div>
                <div className="flex-1 bg-slate-50 rounded-lg p-4 border border-slate-200 min-w-0">
                  <p className="text-xs text-slate-600 mb-1.5">Avg Marks</p>
                  <p className="text-lg font-semibold text-slate-900">{webAnalytics.averageMarks.toFixed(1)}</p>
                </div>
                <div className="flex-1 bg-slate-50 rounded-lg p-4 border border-slate-200 min-w-0">
                  <p className="text-xs text-slate-600 mb-1.5">Avg Accuracy</p>
                  <p className="text-lg font-semibold text-slate-900">{webAnalytics.averageAccuracy.toFixed(1)}%</p>
                </div>
              </div>

              {/* Last 3 Contests Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-3 px-3 font-semibold text-slate-700">Contest</th>
                      <th className="text-left py-3 px-3 font-semibold text-slate-700">Date</th>
                      <th className="text-right py-3 px-3 font-semibold text-slate-700">Marks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {webAnalytics.contests.map((contest, idx) => (
                      <tr key={contest.contestId || idx} className="border-b border-slate-100">
                        <td className="py-3 px-3 text-slate-900">
                          {contest.contestTitle || "Contest"}
                        </td>
                        <td className="py-3 px-3 text-slate-600">
                          {formatTimestamp(contest.date || contest.updatedAt)}
                        </td>
                        <td className="py-3 px-3 text-right font-medium text-slate-900">
                          {contest.rawScore || 0} / {contest.maxScore || 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="p-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-600 text-sm text-center">
              No contests recorded yet
            </div>
          )}
        </section>
      </div>

      {studentRecord && (
        <>
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8">
            <div className="flex justify-between items-start gap-4 flex-wrap mb-6">
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">Comprehensive Report</p>
                <h2 className="text-xl font-bold text-slate-900">Historical Performance Analysis</h2>
              </div>
              <button
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                type="button"
                onClick={loadHistoricalReport}
                disabled={loadingReport}
              >
                {loadingReport ? "Generating..." : "Generate Report"}
              </button>
            </div>
            {loadingReport ? (
              <div className="p-4 rounded-lg border border-dashed border-slate-300 bg-white text-slate-600 text-sm">
                Generating comprehensive report…
              </div>
            ) : historicalReport ? (
              <div className="space-y-6">
                {historicalReport.vedamMeritScore && (
                  <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-6">
                    <h3 className="text-lg font-semibold text-slate-900 mb-4">Vedam Merit Score</h3>
                    <div className="space-y-4">
                      <div className="bg-white rounded-lg p-4 border border-emerald-200">
                        <span className="text-sm text-slate-600 block mb-2">Total Score</span>
                        <span className="text-3xl font-bold text-emerald-700">
                          {historicalReport.vedamMeritScore.total || averageVedam || 0} / 100
                        </span>
                      </div>
                      {historicalReport.vedamMeritScore.breakdown && (
                        <div className="space-y-2 text-sm">
                          <div className="text-slate-700">
                            <strong>Contest Score:</strong> {historicalReport.vedamMeritScore.breakdown.contestScore || "N/A"}
                          </div>
                          <div className="text-slate-700">
                            <strong>Mock Score:</strong> {historicalReport.vedamMeritScore.breakdown.mockScore || "N/A"}
                          </div>
                          {historicalReport.vedamMeritScore.breakdown.explanation && (
                            <p className="text-slate-600 mt-2">
                              {historicalReport.vedamMeritScore.breakdown.explanation}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div className="bg-slate-50 rounded-lg p-6 border border-slate-200">
                  <h3 className="text-lg font-semibold text-slate-900 mb-3">Summary</h3>
                  <p className="text-slate-700 leading-relaxed">{historicalReport.summary}</p>
                  {historicalReport.contestHistory && (
                    <div className="mt-4 pt-4 border-t border-slate-200">
                      <h4 className="font-semibold text-slate-900 mb-2">Contest History</h4>
                      <p className="text-slate-700">{historicalReport.contestHistory}</p>
                    </div>
                  )}
                </div>
                {historicalReport.strengths?.length > 0 && (
                  <div className="bg-green-50 rounded-lg p-6 border border-green-200">
                    <h3 className="text-lg font-semibold text-slate-900 mb-3">Overall Strengths</h3>
                    <ul className="list-disc list-inside space-y-2 text-slate-700">
                      {historicalReport.strengths.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {historicalReport.weaknesses?.length > 0 && (
                  <div className="bg-amber-50 rounded-lg p-6 border border-amber-200">
                    <h3 className="text-lg font-semibold text-slate-900 mb-3">Areas for Improvement</h3>
                    <ul className="list-disc list-inside space-y-2 text-slate-700">
                      {historicalReport.weaknesses.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {historicalReport.recommendations?.length > 0 && (
                  <div className="bg-blue-50 rounded-lg p-6 border border-blue-200">
                    <h3 className="text-lg font-semibold text-slate-900 mb-3">Recommendations</h3>
                    <ul className="list-disc list-inside space-y-2 text-slate-700">
                      {historicalReport.recommendations.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {historicalReport.nextSteps?.length > 0 && (
                  <div className="bg-slate-50 rounded-lg p-6 border border-slate-200">
                    <h3 className="text-lg font-semibold text-slate-900 mb-3">Next Steps</h3>
                    <ul className="list-disc list-inside space-y-2 text-slate-700">
                      {historicalReport.nextSteps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="p-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-600 text-sm">
                Click "Generate Report" to create a comprehensive analysis of your performance across all contests.
              </p>
            )}
          </section>

          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8">
            <div className="mb-6">
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">Practice Library</p>
              <h2 className="text-xl font-bold text-slate-900">Recommended Practice Questions</h2>
            </div>
            {practiceTasks.length > 0 ? (
              <div className="space-y-8">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">Current Contest Practice</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {practiceTasks
                      .filter((t) => t.questionType === "current")
                      .map((task) => (
                        <article key={task.id} className="bg-slate-50 rounded-lg p-5 border border-slate-200 space-y-3">
                          <h4 className="font-semibold text-slate-900">{task.title}</h4>
                          <p className="text-sm text-slate-600">{task.description}</p>
                          <div className="flex flex-wrap gap-2">
                            <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
                              {task.difficulty}
                            </span>
                            {task.topics?.map((topic, i) => (
                              <span key={i} className="px-2 py-1 bg-slate-200 text-slate-700 rounded-full text-xs">
                                {topic}
                              </span>
                            ))}
                          </div>
                          {task.testCases?.length > 0 && (
                            <div className="text-xs text-slate-500">
                              {task.testCases.length} test cases
                            </div>
                          )}
                        </article>
                      ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">Historical Practice (Based on Overall Performance)</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {practiceTasks
                      .filter((t) => t.questionType === "historical")
                      .map((task) => (
                        <article key={task.id} className="bg-slate-50 rounded-lg p-5 border border-slate-200 space-y-3">
                          <h4 className="font-semibold text-slate-900">{task.title}</h4>
                          <p className="text-sm text-slate-600">{task.description}</p>
                          <div className="flex flex-wrap gap-2">
                            <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
                              {task.difficulty}
                            </span>
                            {task.topics?.map((topic, i) => (
                              <span key={i} className="px-2 py-1 bg-slate-200 text-slate-700 rounded-full text-xs">
                                {topic}
                              </span>
                            ))}
                          </div>
                          {task.testCases?.length > 0 && (
                            <div className="text-xs text-slate-500">
                              {task.testCases.length} test cases
                            </div>
                          )}
                        </article>
                      ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="p-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-600 text-sm">
                Practice questions will appear here after you submit code and receive AI evaluations.
              </p>
            )}
          </section>
        </>
      )}

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">Subject performance</h3>
          <p className="text-sm text-slate-600 mb-4">
            Overview of subjects with published Vedam scores.
          </p>
          <ul className="space-y-2">
            {subjectsWithScores.length ? (
              subjectsWithScores.map((subject) => (
                <li key={subject.id} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <div>
                    <strong className="text-slate-900 block">{subject.name}</strong>
                    <small className="text-xs text-slate-500 block mt-0.5">
                      Updated {formatTimestamp(subject.score.updatedAt)}
                    </small>
                  </div>
                  <span className="font-semibold text-slate-900">{subject.score.total} / 100</span>
                </li>
              ))
            ) : (
              <li className="text-sm text-slate-600">No subject data available yet.</li>
            )}
          </ul>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">Contest breakdown</h3>
          <p className="text-sm text-slate-600 mb-4">
            Latest normalized contest entries across your subjects.
          </p>
          <ul className="space-y-2">
            {contestBreakdown.length ? (
              contestBreakdown.slice(0, 6).map((contest) => (
                <li key={`${contest.subjectName}-${contest.contestId}`} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <div>
                    <strong className="text-slate-900 block">{contest.contestTitle || "Contest"}</strong>
                    <small className="text-xs text-slate-500 block mt-0.5">{contest.subjectName}</small>
                  </div>
                  <span className="font-semibold text-slate-900">{contest.normalizedScore} / 50</span>
                </li>
              ))
            ) : (
              <li className="text-sm text-slate-600">No contest scores recorded yet.</li>
            )}
          </ul>
        </div>
      </section>
    </>
  );

  const profileMetrics = [
    {
      label: "Vedam ID",
      value: studentRecord?.vedamId || "Not assigned",
    },
    {
      label: "Innovation lab access",
      value:
        averageVedam !== null
          ? innovationEligible
            ? "Eligible"
            : "Not yet"
          : "Pending data",
    },
    {
      label: "Placement readiness",
      value:
        averageVedam !== null
          ? placementEligible
            ? "Eligible"
            : "Not yet"
          : "Pending data",
    },
    {
      label: "Subjects tracked",
      value: `${subjectsWithScores.length}/${normalizedSubjects.length || "—"}`,
    },
    {
      label: "Contests recorded",
      value: contestTotals,
    },
  ];

  const renderProfile = () => (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">Student profile</p>
        <h2 className="text-xl font-bold text-slate-900">Your Vedam settings</h2>
      </div>
      <div className="bg-slate-50 rounded-lg border border-slate-200 p-6 space-y-6">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="w-14 h-14 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-semibold text-lg">
            {studentRecord?.name
              ? studentRecord.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2)
              : user?.displayName
              ? user.displayName
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2)
              : user?.email?.[0]?.toUpperCase() || "U"}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{studentRecord?.name || user?.displayName || "Vedam Student"}</h3>
            <p className="text-sm text-slate-600">{studentRecord?.email || user?.email}</p>
          </div>
          <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-sm font-medium">
            {averageVedam !== null ? `Average ${averageVedam}` : "Awaiting data"}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {profileMetrics.map((pref) => (
            <article key={pref.label} className="bg-white rounded-lg p-4 border border-slate-200">
              <p className="text-sm text-slate-600 mb-1">{pref.label}</p>
              <p className="text-xl font-semibold text-slate-900">{pref.value}</p>
            </article>
          ))}
        </div>
        <div className="flex justify-between items-center flex-wrap gap-4 pt-4 border-t border-slate-200">
          <div>
            <p className="text-sm text-slate-600 mb-1">Latest update</p>
            <p className="text-xs text-slate-500">
              {subjectsWithScores.length
                ? `Scores updated ${formatTimestamp(
                    subjectsWithScores[0].score?.updatedAt
                  )}`
                : "No published scores yet"}
            </p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="px-4 py-2 bg-red-50 text-red-700 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </section>
  );

  const renderActiveSection = () => {
    if (activeSection === "dashboard") return renderDashboard();
    if (activeSection === "subjects") return renderSubjects();
    if (activeSection === "java") return <JavaEditor user={user} studentRecord={studentRecord} />;
    if (activeSection === "analytics") return renderAnalytics();
    if (activeSection === "profile") return renderProfile();
    return renderDashboard();
  };

  return (
    <div className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[280px_1fr]">
      <Sidebar
        items={navItems}
        activeSection={activeSection}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelect={handleNavSelect}
      />
      <main className="p-6 md:p-10 lg:pl-12">
          <header className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-8 grid grid-cols-[auto_1fr_auto] gap-5 items-center">
            <button
              type="button"
              className="w-11 h-11 rounded-xl bg-slate-900 text-white flex flex-col items-center justify-center gap-1 lg:hidden"
              aria-label="Toggle navigation"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen((prev) => !prev)}
            >
              <span className="w-5 h-0.5 bg-white" />
              <span className="w-5 h-0.5 bg-white" />
              <span className="w-5 h-0.5 bg-white" />
            </button>
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">{copy?.eyebrow || "Dashboard"}</p>
              <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-1">{copy?.heading || "Overview"}</h1>
              <p className="text-sm text-slate-600">{copy?.description || ""}</p>
            </div>
            <div className="flex items-center gap-4 justify-end ml-auto">
              <button
                type="button"
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleRefreshData}
                disabled={dataLoading}
              >
                {dataLoading ? "Refreshing..." : "Refresh"}
              </button>
              <div className="hidden md:flex items-center gap-4">
                {/* Large circular profile avatar with Gmail photo */}
                {user?.photoURL && !profileImageError ? (
                  <img
                    src={user.photoURL}
                    alt="Profile"
                    className="w-16 h-16 rounded-full object-cover flex-shrink-0 shadow-sm border-2 border-slate-200"
                    onError={() => setProfileImageError(true)}
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-blue-500 text-white flex items-center justify-center text-xl font-bold flex-shrink-0 shadow-sm">
                    {studentRecord?.name
                      ? studentRecord.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .toUpperCase()
                          .slice(0, 1)
                      : user?.displayName
                      ? user.displayName
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .toUpperCase()
                          .slice(0, 1)
                      : user?.email?.[0]?.toUpperCase() || "U"}
                  </div>
                )}
                {/* Name and email - vertically centered */}
                <div className="flex flex-col justify-center -space-y-1">
                  <h3 className="text-base font-bold text-slate-900 leading-tight">
                    {studentRecord?.name || user?.displayName || "User"}
                  </h3>
                  <p className="text-sm font-semibold text-slate-700 leading-tight">
                    {studentRecord?.email || user?.email || ""}
                  </p>
                </div>
              </div>
            </div>
          </header>
        <div className="space-y-6 pb-12">{renderActiveSection()}</div>
      </main>
    </div>
  );
};

export default App;

