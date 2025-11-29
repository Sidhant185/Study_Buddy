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
import { evaluateCodeSubmission } from "../services/cursorAI.js";

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

  useEffect(() => {
    loadContests();
  }, []);

  useEffect(() => {
    if (selectedContest && studentRecord) {
      loadQuestions();
    }
  }, [selectedContest, studentRecord]);

  useEffect(() => {
    if (selectedQuestion) {
      // Load starter template or previous submission
      setCode(selectedQuestion.codeTemplate || "public class Solution {\n    // Your code here\n}");
      setOutput("");
      setTestResults(null);
      setEvaluation(null);
      loadEvaluation();
      loadPracticeTasks();
    }
  }, [selectedQuestion]);

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

  const handleSubmit = async () => {
    if (!code.trim() || !selectedQuestion || !studentRecord || !selectedContest) {
      setError("Please complete all fields before submitting.");
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
    <div className="java-editor">
      <div className="java-editor__header">
        <h2>Java Contest Coding Environment</h2>
        <p>Write, test, and submit your Java solutions</p>
      </div>

      <div className="java-editor__layout">
        <div className="java-editor__sidebar">
          <div className="java-editor__section">
            <h3>Contests</h3>
            <select
              value={selectedContest?.id || ""}
              onChange={(e) => {
                const contest = contests.find((c) => c.id === e.target.value);
                setSelectedContest(contest);
                setSelectedQuestion(null);
              }}
              className="java-editor__select"
            >
              {contests.map((contest) => (
                <option key={contest.id} value={contest.id}>
                  {contest.title}
                </option>
              ))}
            </select>
          </div>

          {selectedContest && (
            <div className="java-editor__section">
              <h3>Questions</h3>
              <div className="java-editor__questions">
                {questions.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    className={`java-editor__question-btn ${
                      selectedQuestion?.id === q.id ? "active" : ""
                    }`}
                    onClick={() => setSelectedQuestion(q)}
                  >
                    Q{q.questionNumber}: {q.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          {evaluation && (
            <div className="java-editor__section">
              <h3>AI Evaluation</h3>
              <div className="java-editor__evaluation">
                <div className="java-editor__score">
                  Score: {evaluation.overallScore}/100
                </div>
                <div>
                  <strong>Strengths:</strong>
                  <ul>
                    {evaluation.strengths?.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>Weaknesses:</strong>
                  <ul>
                    {evaluation.weaknesses?.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
                {evaluation.detailedAnalysis && (
                  <div>
                    <strong>Analysis:</strong>
                    <p>{evaluation.detailedAnalysis}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {practiceTasks.length > 0 && (
            <div className="java-editor__section">
              <h3>Practice Questions</h3>
              <div className="java-editor__practice">
                {practiceTasks.slice(0, 5).map((task) => (
                  <div key={task.id} className="java-editor__practice-item">
                    <strong>{task.title}</strong>
                    <p>{task.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="java-editor__main">
          {selectedQuestion ? (
            <>
              <div className="java-editor__question">
                <h3>Q{selectedQuestion.questionNumber}: {selectedQuestion.title}</h3>
                <p>{selectedQuestion.description}</p>
                {selectedQuestion.testCases?.length > 0 && (
                  <div className="java-editor__test-cases">
                    <strong>Test Cases:</strong>
                    <ul>
                      {selectedQuestion.testCases.map((tc, i) => (
                        <li key={i}>
                          Input: <code>{tc.input}</code> → Expected: <code>{tc.expectedOutput}</code>
                        </li>
                      ))}
                    </ul>
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
                <button
                  type="button"
                  onClick={() => setShowSubmitDialog(true)}
                  disabled={submitting}
                  className="java-editor__btn java-editor__btn--submit"
                >
                  Submit Final Solution
                </button>
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
    </div>
  );
};

export default JavaEditor;

