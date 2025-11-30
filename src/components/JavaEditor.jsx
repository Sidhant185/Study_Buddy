import { useState, useEffect } from "react";
import { executeJavaCode, runTestCases } from "../services/piston.js";
import {
  listSubjects,
  listContests,
  listContestQuestions,
  listContestSubmissions,
  createSubmission,
  getSubmissionEvaluation,
  listPracticeTasks,
  updateSubmissionStatus,
  createEvaluation,
  getTopicAnalytics,
  upsertTopicAnalytics,
  createPracticeTask,
  parseTestCases,
} from "../services/firestore.js";
import { evaluateCodeSubmission, generateJavaCodingQuestions } from "../services/cursorAI.js";
import { getCachedJavaPractice, setCachedJavaPractice } from "../services/cache.js";

const JavaEditor = ({ user, studentRecord }) => {
  const [contests, setContests] = useState([]);
  const [selectedContest, setSelectedContest] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [selectedQuestion, setSelectedQuestion] = useState(null);
  const [code, setCode] = useState("");
  const [output, setOutput] = useState("");
  const [testResults, setTestResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [wantAIReview, setWantAIReview] = useState(false);
  const [evaluation, setEvaluation] = useState(null);
  const [practiceTasks, setPracticeTasks] = useState([]);
  const [error, setError] = useState(null);
  
  // Custom Practice Mode State
  const [customPracticeModal, setCustomPracticeModal] = useState(false);
  const [customPracticeForm, setCustomPracticeForm] = useState({
    topics: "",
    difficulty: "medium",
  });
  const [generatingQuestions, setGeneratingQuestions] = useState(false);
  const [customQuestions, setCustomQuestions] = useState([]);
  const [isCustomPractice, setIsCustomPractice] = useState(false);
  const [currentTestCaseIndex, setCurrentTestCaseIndex] = useState(0);
  const [customPracticeEvaluation, setCustomPracticeEvaluation] = useState(null);
  const [evaluatingCustomPractice, setEvaluatingCustomPractice] = useState(false);
  const [refreshingCustomPractice, setRefreshingCustomPractice] = useState(false);

  useEffect(() => {
    loadContests();
  }, []);

  useEffect(() => {
    if (selectedContest && studentRecord && !isCustomPractice) {
      loadQuestions();
    }
  }, [selectedContest, studentRecord, isCustomPractice]);

  useEffect(() => {
    if (selectedQuestion) {
      // Load starter template or previous submission
      let template = selectedQuestion.codeTemplate || "public class Solution {\n    // Your code here\n}";
      
      // For custom practice questions, ensure we have a proper template
      if (isCustomPractice && selectedQuestion.codeTemplate) {
        template = selectedQuestion.codeTemplate;
      }
      
      setCode(template);
      setOutput("");
      setTestResults(null);
      setEvaluation(null);
      if (!isCustomPractice) {
        loadEvaluation();
        loadPracticeTasks();
      }
    }
  }, [selectedQuestion, isCustomPractice]);

  const loadContests = async () => {
    try {
      const subjects = await listSubjects();
      const javaSubject = subjects.find((s) => s?.name?.toLowerCase() === "java");
      if (!javaSubject) {
        setError("Java subject not found. Please contact admin.");
        return;
      }
      const contestList = await listContests(javaSubject.id);
      setContests(contestList);
      if (contestList.length > 0 && !selectedContest) {
        setSelectedContest(contestList[0]);
      }
    } catch (err) {
      console.error("Failed to load contests", err);
      setError("Failed to load contests.");
    }
  };

  const loadQuestions = async () => {
    if (!selectedContest || !studentRecord) return;
    try {
      const subjects = await listSubjects();
      const javaSubject = subjects.find((s) => s?.name?.toLowerCase() === "java");
      if (!javaSubject) return;
      
      const questionList = await listContestQuestions(javaSubject.id, selectedContest.id);
      setQuestions(questionList);
      if (questionList.length > 0 && !selectedQuestion) {
        setSelectedQuestion(questionList[0]);
      }
    } catch (err) {
      console.error("Failed to load questions", err);
      setError("Failed to load questions.");
    }
  };

  const loadEvaluation = async () => {
    if (!selectedQuestion || !studentRecord || !selectedContest) return;
    try {
      const subjects = await listSubjects();
      const javaSubject = subjects.find((s) => s?.name?.toLowerCase() === "java");
      if (!javaSubject) return;
      
      // Find submission for this question
      const submissions = await listContestSubmissions(
        javaSubject.id,
        selectedContest.id,
        studentRecord.id
      );
      const submission = submissions.find((s) => s.questionId === selectedQuestion.id);
      if (submission && submission.status === "evaluated") {
        const evalData = await getSubmissionEvaluation(
          javaSubject.id,
          selectedContest.id,
          submission.id
        );
        setEvaluation(evalData);
      }
    } catch (err) {
      console.error("Failed to load evaluation", err);
    }
  };

  const loadPracticeTasks = async () => {
    if (!studentRecord) return;
    try {
      const subjects = await listSubjects();
      const javaSubject = subjects.find((s) => s?.name?.toLowerCase() === "java");
      if (!javaSubject) return;
      
      const tasks = await listPracticeTasks(studentRecord.id, {
        subjectId: javaSubject.id,
        questionType: selectedContest ? "current" : "historical",
      });
      setPracticeTasks(tasks);
    } catch (err) {
      console.error("Failed to load practice tasks", err);
    }
  };

  const handleRunCode = async () => {
    if (!code.trim()) {
      setOutput("Please write some code first.");
      return;
    }

    setLoading(true);
    setOutput("");
    setError(null);

    try {
      const result = await executeJavaCode(code, []);
      setOutput(result.stdout || result.stderr || "No output");
      if (result.stderr && !result.stdout) {
        setError(result.stderr);
      } else {
        setError(null);
      }
    } catch (err) {
      setError(err.message || "Failed to execute code");
      setOutput("");
    } finally {
      setLoading(false);
    }
  };

  const handleRunTests = async () => {
    if (!code.trim() || !selectedQuestion) {
      setError("Please write code and select a question first.");
      return;
    }

    setLoading(true);
    setTestResults(null);
    setError(null);

    try {
      // Parse testCases consistently
      const testCases = Array.isArray(selectedQuestion.testCases) 
        ? selectedQuestion.testCases 
        : (typeof selectedQuestion.testCases === 'string' && selectedQuestion.testCases.trim())
          ? JSON.parse(selectedQuestion.testCases)
          : [];
          
      console.log(`🧪 handleRunTests: Running ${testCases.length} test cases for question "${selectedQuestion.title}"`);
      
      if (testCases.length === 0) {
        setError("No test cases available for this question.");
        setLoading(false);
        return;
      }

      const results = await runTestCases(code, testCases);
      setTestResults(results);
      console.log(`✅ handleRunTests: Test execution completed. Passed: ${results.passed}/${results.total}`);
    } catch (err) {
      console.error("JavaEditor test execution error:", {
        error: err.message,
        question: selectedQuestion?.title,
        codeLength: code?.length || 0
      });
      setError(err.message || "Failed to run tests");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateCustomQuestions = async (forceRefresh = false) => {
    if (!customPracticeForm.topics.trim()) {
      setError("Please enter at least one topic");
      return;
    }

    const params = {
      topics: customPracticeForm.topics.trim(),
      difficulty: customPracticeForm.difficulty,
    };

    // Check cache first if not forcing refresh
    if (!forceRefresh) {
      const cached = getCachedJavaPractice(params);
      if (cached && cached.questions) {
        const formattedQuestions = cached.questions.map((q, idx) => ({
          ...q,
          id: q.id || `custom-${idx}`,
          questionNumber: q.questionNumber || (idx + 1),
          testCases: q.testCases || [],
        }));
        setCustomQuestions(formattedQuestions);
        setCustomPracticeModal(false);
        setCurrentTestCaseIndex(0);
        if (formattedQuestions.length > 0) {
          setSelectedQuestion(formattedQuestions[0]);
        }
        return;
      }
    }

    setGeneratingQuestions(true);
    setError(null);
    try {
      const generatedQuestions = await generateJavaCodingQuestions(params);
      
      // Format questions to match expected structure
      const formattedQuestions = generatedQuestions.map((q, idx) => ({
        ...q,
        id: q.id || `custom-${idx}`,
        questionNumber: q.questionNumber || (idx + 1),
        testCases: q.testCases || [],
      }));
      
      // Cache the generated questions
      setCachedJavaPractice(params, generatedQuestions);
      
      setCustomQuestions(formattedQuestions);
      setCustomPracticeModal(false);
      setCurrentTestCaseIndex(0);
      if (formattedQuestions.length > 0) {
        setSelectedQuestion(formattedQuestions[0]);
      }
    } catch (err) {
      console.error("Failed to generate custom questions", err);
      setError(`Failed to generate questions: ${err.message}`);
    } finally {
      setGeneratingQuestions(false);
      setRefreshingCustomPractice(false);
    }
  };

  const handleRefreshCustomPractice = async () => {
    if (!customPracticeForm.topics.trim()) {
      setError("Please enter at least one topic first");
      return;
    }
    setRefreshingCustomPractice(true);
    await handleGenerateCustomQuestions(true);
  };

  const handleEvaluateCustomPractice = async () => {
    if (!code.trim() || !selectedQuestion) {
      setError("Please write code and select a question first.");
      return;
    }

    setEvaluatingCustomPractice(true);
    setError(null);
    setCustomPracticeEvaluation(null);

    try {
      // Get all test cases
      const testCases = selectedQuestion.testCases || [];
      
      // Run all test cases
      const results = await runTestCases(code, testCases);
      
      // Evaluate with AI
      const evaluation = await evaluateCodeSubmission({
        studentCode: code.trim(),
        expectedSolution: "",
        questionDescription: selectedQuestion.description || selectedQuestion.title,
        testCases: testCases.map(tc => ({
          input: tc.input,
          expectedOutput: tc.expectedOutput,
        })),
        studentHistory: null,
      });

      setCustomPracticeEvaluation({
        ...evaluation,
        testResults: results,
      });
    } catch (err) {
      console.error("Custom practice evaluation failed", err);
      setError(`Evaluation failed: ${err.message}`);
    } finally {
      setEvaluatingCustomPractice(false);
    }
  };

  const handleSubmit = async () => {
    if (!code.trim() || !selectedQuestion || !studentRecord) {
      setError("Please complete all fields before submitting.");
      return;
    }
    
    if (isCustomPractice) {
      setError("Custom practice questions cannot be submitted. Use regular contests for submission.");
      return;
    }
    
    if (!selectedContest) {
      setError("Please select a contest.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const subjects = await listSubjects();
      const javaSubject = subjects.find((s) => s?.name?.toLowerCase() === "java");
      if (!javaSubject) {
        throw new Error("Java subject not found");
      }

      // Create submission
      const submissionRef = await createSubmission({
        subjectId: javaSubject.id,
        contestId: selectedContest.id,
        studentId: studentRecord.id,
        questionId: selectedQuestion.id,
        code: code.trim(),
        language: "java",
      });

      // Update status to submitted
      await updateSubmissionStatus(
        javaSubject.id,
        selectedContest.id,
        submissionRef.id,
        "submitted"
      );

      if (wantAIReview) {
        // AUTO-TRIGGER AI EVALUATION
        setOutput("Submission successful! Starting AI evaluation...");
        
        try {
          // Update status to evaluating
          await updateSubmissionStatus(
            javaSubject.id,
            selectedContest.id,
            submissionRef.id,
            "evaluating"
          );

          // Get student history for context
          const topicAnalytics = await getTopicAnalytics(studentRecord.id, javaSubject.id);

          // Parse testCases consistently
          const parsedTestCases = parseTestCases(selectedQuestion.testCases);

          // Call AI evaluation
          const evaluation = await evaluateCodeSubmission({
            studentCode: code.trim(),
            expectedSolution: selectedQuestion.expectedSolution || "",
            questionDescription: selectedQuestion.description || selectedQuestion.title,
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
            contestId: selectedContest.id,
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
            studentId: studentRecord.id,
            subjectId: javaSubject.id,
            topicUpdates,
          });

          // Generate 5-10 practice questions
          const practiceQuestions = evaluation.practiceQuestions || [];
          const questionsToGenerate = Math.min(Math.max(5, practiceQuestions.length), 10);
          
          for (let i = 0; i < questionsToGenerate; i++) {
            const practiceQ = practiceQuestions[i];
            if (practiceQ) {
              await createPracticeTask({
                studentId: studentRecord.id,
                subjectId: javaSubject.id,
                task: {
                  contestId: selectedContest.id,
                  questionType: "current",
                  ...practiceQ,
                },
              });
            }
          }

          // Update submission status
          await updateSubmissionStatus(
            javaSubject.id,
            selectedContest.id,
            submissionRef.id,
            "evaluated",
            { evaluatedAt: new Date() }
          );

          setOutput("Submission evaluated! Check the sidebar for your AI feedback and practice questions.");
          // Reload evaluation to show in sidebar
          await loadEvaluation();
          await loadPracticeTasks();
        } catch (evalError) {
          console.error("AI evaluation failed", evalError);
          await updateSubmissionStatus(
            javaSubject.id,
            selectedContest.id,
            submissionRef.id,
            "error",
            { error: evalError.message }
          );
          setOutput("Submission saved, but AI evaluation failed. Contact your mentor.");
        }
      } else {
        setOutput("Submission successful! You can request AI review later from the admin panel.");
      }

      setShowSubmitDialog(false);
      setWantAIReview(false);
      
      // Reload to show updated status
      await loadQuestions();
    } catch (err) {
      console.error("Failed to submit", err);
      setError(err.message || "Failed to submit code");
    } finally {
      setSubmitting(false);
    }
  };

  if (error && !contests.length) {
    return (
      <div className="java-editor">
        <div className="java-editor__error">{error}</div>
      </div>
    );
  }

  return (
    <>
    <div className="java-editor">
      <div className="java-editor__header">
        <div>
          <h2>Java Contest Coding Environment</h2>
          <p>Write, test, and submit your Java solutions</p>
        </div>
        {isCustomPractice && (
          <button
            onClick={handleRefreshCustomPractice}
            disabled={refreshingCustomPractice || !customPracticeForm.topics.trim()}
            className="java-editor__header-refresh-btn"
            title="Refresh custom practice questions"
          >
            {refreshingCustomPractice ? (
              <span className="animate-spin">⏳</span>
            ) : (
              <span>🔄</span>
            )}
          </button>
        )}
      </div>

      <div className="java-editor__layout">
        <div className="java-editor__sidebar">
          <div className="java-editor__section">
            <h3>Contests</h3>
            <select
              value={isCustomPractice ? "custom" : (selectedContest?.id || "")}
              onChange={(e) => {
                if (e.target.value === "custom") {
                  setIsCustomPractice(true);
                  setSelectedContest(null);
                  setSelectedQuestion(null);
                  setQuestions([]);
                  
                  // Check cache for existing custom practice
                  const cached = getCachedJavaPractice({
                    topics: customPracticeForm.topics.trim() || "",
                    difficulty: customPracticeForm.difficulty,
                  });
                  
                  if (cached && cached.questions && customPracticeForm.topics.trim()) {
                    const formattedQuestions = cached.questions.map((q, idx) => ({
                      ...q,
                      id: q.id || `custom-${idx}`,
                      questionNumber: q.questionNumber || (idx + 1),
                      testCases: q.testCases || [],
                    }));
                    setCustomQuestions(formattedQuestions);
                    if (formattedQuestions.length > 0) {
                      setSelectedQuestion(formattedQuestions[0]);
                    }
                  } else {
                    setCustomQuestions([]);
                    setCustomPracticeModal(true);
                  }
                } else {
                  setIsCustomPractice(false);
                  const contest = contests.find((c) => c.id === e.target.value);
                  setSelectedContest(contest);
                  setSelectedQuestion(null);
                  setCustomQuestions([]);
                }
              }}
              className="java-editor__select"
            >
              <option value="">Select a contest</option>
              {contests.map((contest) => (
                <option key={contest.id} value={contest.id}>
                  {contest.title}
                </option>
              ))}
              <option value="custom">Custom Practice</option>
            </select>
          </div>

          {(selectedContest || isCustomPractice) && (
            <div className="java-editor__section">
              <h3>Questions</h3>
              <div className="java-editor__questions">
                {(isCustomPractice ? customQuestions : questions).map((q, idx) => (
                  <button
                    key={q.id || idx}
                    type="button"
                    className={`java-editor__question-btn ${
                      selectedQuestion?.id === q.id ? "active" : ""
                    }`}
                    onClick={() => setSelectedQuestion(q)}
                  >
                    Q{q.questionNumber || (idx + 1)}: {q.title}
                  </button>
                ))}
              </div>
            </div>
          )}

        </div>

        <div className="java-editor__main">
          {selectedQuestion ? (
            <>
              <div className="java-editor__question">
                <div className="java-editor__question-header">
                  <h3>Q{selectedQuestion.questionNumber || 1}: {selectedQuestion.title}</h3>
                  {selectedQuestion.difficulty && (
                    <span className={`java-editor__difficulty java-editor__difficulty--${selectedQuestion.difficulty}`}>
                      {selectedQuestion.difficulty === "easy" ? "🟢 Easy" : 
                       selectedQuestion.difficulty === "medium" ? "🟡 Medium" : 
                       "🔴 Hard"}
                    </span>
                  )}
                </div>
                <p>{selectedQuestion.description}</p>
                {selectedQuestion.testCases?.length > 0 && (
                  <div className="java-editor__test-cases">
                    <div className="java-editor__test-cases-header">
                      <strong>Test Case {isCustomPractice ? currentTestCaseIndex + 1 : 'All'}:</strong>
                      {isCustomPractice && selectedQuestion.testCases.length > 1 && (
                        <div className="java-editor__test-case-nav">
                          <button
                            type="button"
                            onClick={() => setCurrentTestCaseIndex(prev => Math.max(0, prev - 1))}
                            disabled={currentTestCaseIndex === 0}
                            className="java-editor__test-case-nav-btn"
                          >
                            ← Previous
                          </button>
                          <span className="java-editor__test-case-counter">
                            {currentTestCaseIndex + 1} / {selectedQuestion.testCases.length}
                          </span>
                          <button
                            type="button"
                            onClick={() => setCurrentTestCaseIndex(prev => Math.min(selectedQuestion.testCases.length - 1, prev + 1))}
                            disabled={currentTestCaseIndex === selectedQuestion.testCases.length - 1}
                            className="java-editor__test-case-nav-btn"
                          >
                            Next →
                          </button>
                        </div>
                      )}
                    </div>
                    {isCustomPractice ? (
                      <div className="java-editor__test-case-single">
                        <div className="java-editor__test-case-item">
                          <span className="java-editor__test-case-label">Test {currentTestCaseIndex + 1}:</span>
                          <div className="java-editor__test-case-content">
                            <div className="java-editor__test-case-input">
                              <strong>Input:</strong>
                              <pre className="java-editor__test-case-pre"><code>{selectedQuestion.testCases[currentTestCaseIndex].input}</code></pre>
                            </div>
                            <div className="java-editor__test-case-output">
                              <strong>Expected Output:</strong>
                              <pre className="java-editor__test-case-pre"><code>{selectedQuestion.testCases[currentTestCaseIndex].expectedOutput}</code></pre>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <ul>
                        {selectedQuestion.testCases.map((tc, i) => (
                          <li key={i}>
                            <span className="java-editor__test-case-label">Test {i + 1}:</span>
                            <span className="java-editor__test-case-input">Input: <code>{tc.input}</code></span>
                            <span className="java-editor__test-case-output">→ Expected: <code>{tc.expectedOutput}</code></span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              <div className="java-editor__code-area">
                <textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Write your Java code here..."
                  className="java-editor__textarea"
                  spellCheck={false}
                />
              </div>

              <div className="java-editor__actions">
                <button
                  type="button"
                  onClick={handleRunCode}
                  disabled={loading}
                  className="java-editor__btn java-editor__btn--run"
                >
                  {loading ? "Running..." : "Run Code"}
                </button>
                <button
                  type="button"
                  onClick={handleRunTests}
                  disabled={loading || !selectedQuestion.testCases?.length}
                  className="java-editor__btn java-editor__btn--test"
                >
                  {loading ? "Testing..." : "Run Tests"}
                </button>
                {!isCustomPractice && (
                  <button
                    type="button"
                    onClick={() => setShowSubmitDialog(true)}
                    disabled={submitting}
                    className="java-editor__btn java-editor__btn--submit"
                  >
                    Submit Final Solution
                  </button>
                )}
                {isCustomPractice && (
                  <button
                    type="button"
                    onClick={handleEvaluateCustomPractice}
                    disabled={evaluatingCustomPractice || loading}
                    className="java-editor__btn java-editor__btn--evaluate"
                  >
                    {evaluatingCustomPractice ? "Evaluating..." : "AI Evaluate"}
                  </button>
                )}
              </div>

              {output && (
                <div className="java-editor__output">
                  <h4>Output:</h4>
                  <pre>{output}</pre>
                </div>
              )}

              {error && (
                <div className="java-editor__error">
                  <strong>Error:</strong> {error}
                </div>
              )}

              {testResults && (
                <div className="java-editor__test-results">
                  <h4>Test Results:</h4>
                  <div>
                    <strong>
                      {testResults.passed}/{testResults.total} tests passed
                    </strong>
                  </div>
                  {testResults.results.map((result, i) => (
                    <div
                      key={i}
                      className={`java-editor__test-result ${
                        result.passed ? "passed" : "failed"
                      }`}
                    >
                      <strong>Test {result.testCaseNumber}:</strong>{" "}
                      {result.passed ? "✓ Passed" : "✗ Failed"}
                      {!result.passed && (
                        <div>
                          Expected: <code>{result.expectedOutput}</code>
                          <br />
                          Got: <code>{result.actualOutput}</code>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="java-editor__placeholder">
              <p>Select a contest and question to start coding.</p>
            </div>
          )}
        </div>
      </div>

      {showSubmitDialog && (
        <div className="java-editor__dialog-overlay">
          <div className="java-editor__dialog">
            <h3>Submit Final Solution</h3>
            <p>Are you sure you want to submit this code as your final solution?</p>
            <div className="java-editor__dialog-options">
              <label>
                <input
                  type="checkbox"
                  checked={wantAIReview}
                  onChange={(e) => setWantAIReview(e.target.checked)}
                />
                Request AI review and detailed feedback
              </label>
            </div>
            <div className="java-editor__dialog-actions">
              <button
                type="button"
                onClick={() => {
                  setShowSubmitDialog(false);
                  setWantAIReview(false);
                }}
                className="java-editor__btn java-editor__btn--cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="java-editor__btn java-editor__btn--submit"
              >
                {submitting ? "Submitting..." : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Practice Modal */}
      {customPracticeModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="quiz-modal-container">
            <div className="quiz-modal-header">
              <h3 className="quiz-modal-title">Generate Custom Practice Questions</h3>
              <button
                onClick={() => setCustomPracticeModal(false)}
                className="quiz-modal-close"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            
            <div className="quiz-modal-content">
              <div className="quiz-form-group">
                <label className="quiz-form-label">
                  Topics <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={customPracticeForm.topics}
                  onChange={(e) => setCustomPracticeForm(prev => ({ ...prev, topics: e.target.value }))}
                  placeholder="e.g., Arrays, Strings, OOP, Collections, Recursion (comma-separated)"
                  className="quiz-form-textarea"
                  rows="3"
                />
                <p className="text-xs text-slate-500 mt-1">Enter 1 or more topics separated by commas</p>
              </div>

              <div className="quiz-form-group">
                <label className="quiz-form-label">
                  Difficulty
                </label>
                <select
                  value={customPracticeForm.difficulty}
                  onChange={(e) => setCustomPracticeForm(prev => ({ ...prev, difficulty: e.target.value }))}
                  className="quiz-form-select"
                >
                  <option value="easy">🟢 Easy</option>
                  <option value="medium">🟡 Medium</option>
                  <option value="hard">🔴 Hard</option>
                </select>
              </div>

              <div className="quiz-form-group">
                <p className="text-sm text-slate-600">
                  <strong>Number of Questions:</strong> Fixed at 5
                </p>
              </div>

              <button
                onClick={handleGenerateCustomQuestions}
                disabled={generatingQuestions || !customPracticeForm.topics.trim()}
                className="quiz-form-submit"
              >
                {generatingQuestions ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    Generating Questions...
                  </>
                ) : (
                  "Generate Questions"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

    {evaluation && (
      <div className="java-ai-evaluation">
        <div className="java-ai-evaluation__header">
          <h3>AI Evaluation</h3>
        </div>
        <div className="java-ai-evaluation__content">
          <div className="java-ai-evaluation__score">
            <span className="java-ai-evaluation__score-label">Score</span>
            <span className="java-ai-evaluation__score-value">{evaluation.overallScore}/100</span>
          </div>
          
          <div className="java-ai-evaluation__section">
            <strong className="java-ai-evaluation__section-title">Strengths</strong>
            <ul className="java-ai-evaluation__list">
              {evaluation.strengths?.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
          
          <div className="java-ai-evaluation__section">
            <strong className="java-ai-evaluation__section-title">Weaknesses</strong>
            <ul className="java-ai-evaluation__list">
              {evaluation.weaknesses?.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    )}

    {customPracticeEvaluation && (
      <div className="java-ai-evaluation">
        <div className="java-ai-evaluation__header">
          <h3>AI Evaluation (Custom Practice)</h3>
        </div>
        <div className="java-ai-evaluation__content">
          {customPracticeEvaluation.testResults && (
            <div className="java-ai-evaluation__section">
              <strong className="java-ai-evaluation__section-title">Test Results</strong>
              <p className="java-ai-evaluation__test-summary">
                Passed: {customPracticeEvaluation.testResults.passed} / {customPracticeEvaluation.testResults.total}
              </p>
            </div>
          )}
          
          <div className="java-ai-evaluation__score">
            <span className="java-ai-evaluation__score-label">Score</span>
            <span className="java-ai-evaluation__score-value">{customPracticeEvaluation.overallScore}/100</span>
          </div>
          
          <div className="java-ai-evaluation__section">
            <strong className="java-ai-evaluation__section-title">Strengths</strong>
            <ul className="java-ai-evaluation__list">
              {customPracticeEvaluation.strengths?.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
          
          <div className="java-ai-evaluation__section">
            <strong className="java-ai-evaluation__section-title">Weaknesses</strong>
            <ul className="java-ai-evaluation__list">
              {customPracticeEvaluation.weaknesses?.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    )}

    {practiceTasks.length > 0 && (
      <div className="java-practice-questions">
        <div className="java-practice-questions__header">
          <h3>Practice Questions</h3>
        </div>
        <div className="java-practice-questions__content">
          {practiceTasks.slice(0, 5).map((task) => (
            <div key={task.id} className="java-practice-questions__item">
              <strong>{task.title}</strong>
              <p>{task.description}</p>
            </div>
          ))}
        </div>
      </div>
    )}
  </>
  );
};

export default JavaEditor;

