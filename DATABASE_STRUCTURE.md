# Firestore Database Structure

## Collections Overview

### Top-Level Collections

1. **`subjects`** - Subject catalog (Maths, Java, Web)
   - Fields: `name`, `description`, `createdAt`, etc.

2. **`students`** - Student records
   - Fields: `name`, `email`, `vedamId`, `createdAt`, etc.

3. **`studentSubjectScores`** - Vedam Merit Scores per subject
   - Document ID: `{studentId}_{subjectId}`
   - Fields: `studentId`, `subjectId`, `contestScaled40`, `mockScore`, `total`, etc.

4. **`topicAnalytics`** - Topic performance analytics per student-subject
   - Document ID: `{studentId}_{subjectId}`
   - Fields: `studentId`, `subjectId`, `topics` (object with topic scores/strengths), `updatedAt`

5. **`practiceTasks`** - Practice questions for students
   - Fields: `studentId`, `subjectId`, `contestId`, `questionType` ("current" or "historical"), `title`, `description`, `codeTemplate`, `testCases`, `topics`, `difficulty`, `status`, `createdAt`

### Subcollections (Nested)

#### Under `subjects/{subjectId}/contests/{contestId}`

1. **`questions`** - Contest questions
   - Fields: `questionNumber`, `title`, `description`, `expectedSolution`, `testCases`, `maxScore`, `topics`, `difficulty`, `createdAt`

2. **`submissions`** - Student submissions for contest
   - Fields: `studentId`, `questionId`, `code`, `language`, `status` ("submitted", "evaluating", "evaluated"), `submittedAt`, `evaluatedAt`

   - **Subcollection: `evaluations`** - AI evaluation reports
     - Fields: `strengths`, `weaknesses`, `suggestions`, `topicScores`, `overallScore`, `detailedAnalysis`, `practiceQuestions`, `evaluatedAt`

## Query Patterns

### Practice Tasks Query
- **Base Query**: Filter by `studentId` + `orderBy createdAt`
- **Additional Filters**: Applied in memory (subjectId, questionType, status) to avoid composite index requirement
- **Why**: Firestore requires composite indexes for multiple `where` clauses with `orderBy`. Filtering in memory avoids this requirement.

### Evaluations Query
- Path: `subjects/{subjectId}/contests/{contestId}/submissions/{submissionId}/evaluations`
- Queried by listing all evaluations for a student-subject pair

## Data Flow

1. **Contest Upload**: Admin creates contest → questions stored as subcollection
2. **Submission Upload**: Admin uploads student code → stored in submissions subcollection
3. **AI Evaluation**: Automatic evaluation → creates evaluation document → updates topicAnalytics
4. **Practice Questions**: Generated from evaluation → stored in practiceTasks collection
5. **Student Dashboard**: Fetches evaluations, practiceTasks, topicAnalytics to display

## Index Requirements

Currently **NO composite indexes required** because:
- Practice tasks query filters in memory after base query
- Other queries use single-field filters or path-based queries

