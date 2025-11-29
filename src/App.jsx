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
import { generateHistoricalReport, generateHistoricalPracticeQuestions } from "./services/cursorAI.js";

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
            <div className="flex items-center gap-4">
              <button
                type="button"
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleRefreshData}
                disabled={dataLoading}
              >
                {dataLoading ? "Refreshing..." : "Refresh"}
              </button>
              <div className="hidden md:flex items-center gap-3 px-3 py-2 bg-slate-50 rounded-full">
                <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center text-sm font-semibold">
                  {user?.displayName
                    ? user.displayName
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .toUpperCase()
                        .slice(0, 2)
                    : user?.email?.[0]?.toUpperCase() || "U"}
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900">{user?.displayName?.split(" ")[0] || user?.email?.split("@")[0] || "User"}</p>
                  <small className="text-xs text-slate-500">Focus mode · On</small>
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

