import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  real,
  pgEnum,
  uniqueIndex,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Access model ─────────────────────────────────────────────────────────────
// Every table has Row Level Security enabled with NO policies (deny-all), and
// PostgREST grants are revoked from `anon`/`authenticated` (see
// drizzle/0002_revoke_postgrest_grants.sql). All application data access goes
// through Drizzle server-side as the table owner, where role/ownership checks
// live in code (lib/auth/session.ts + lib/data/*). The Supabase REST API is
// therefore a wall, not a data path. Add a pgPolicy only if a client-side
// reader (e.g. Realtime) is introduced, and only for that table.

// ─── Enums ────────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", [
  "student",
  "professor",
  "admin",
]);

export const questionTypeEnum = pgEnum("question_type", [
  "multiple_choice",
  "true_false",
  "fill_in_the_blank",
  "short_essay",
]);

// ─── Users ────────────────────────────────────────────────────────────────────
// Mirrors Supabase Auth's auth.users table — this is the public profile table.
// The id must match the Supabase Auth user id exactly.

export const users = pgTable("users", {
  id: uuid("id").primaryKey(), // references auth.users(id)
  email: text("email").unique(),
  phone: text("phone").unique(),
  role: userRoleEnum("role").notNull().default("student"),
  fullName: text("full_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

// ─── Courses ──────────────────────────────────────────────────────────────────

export const courses = pgTable("courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  professorId: uuid("professor_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

// ─── Enrollments ──────────────────────────────────────────────────────────────

export const enrollments = pgTable(
  "enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("enrollments_student_course_idx").on(t.studentId, t.courseId)]
).enableRLS();

// ─── Lectures ─────────────────────────────────────────────────────────────────

export const lectures = pgTable(
  "lectures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // Supabase Storage path — served via signed URL at request time
    videoStoragePath: text("video_storage_path").notNull(),
    order: integer("order").notNull().default(0),
    // Percentage (0–100) of video that must be watched to mark complete.
    // Default is 95 per spec.
    completionThreshold: real("completion_threshold").notNull().default(95),
    // Optional end-of-lecture comprehension question
    comprehensionQuestion: text("comprehension_question"),
    comprehensionOptions: jsonb("comprehension_options"), // string[] for MC, null otherwise
    comprehensionAnswer: text("comprehension_answer"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("lectures_course_order_idx").on(t.courseId, t.order)]
).enableRLS();

// ─── Lecture Progress ─────────────────────────────────────────────────────────

export const lectureProgress = pgTable(
  "lecture_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lectureId: uuid("lecture_id")
      .notNull()
      .references(() => lectures.id, { onDelete: "cascade" }),
    watchedSeconds: real("watched_seconds").notNull().default(0),
    // Server-validated: only true when watched_seconds/duration >= completionThreshold
    completed: boolean("completed").notNull().default(false),
    lastUpdated: timestamp("last_updated", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("lecture_progress_student_lecture_idx").on(
      t.studentId,
      t.lectureId
    ),
  ]
).enableRLS();

// ─── Exams ────────────────────────────────────────────────────────────────────

export const exams = pgTable("exams", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  // null = draft; set by professor to publish
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

// ─── Exam Questions ───────────────────────────────────────────────────────────

export const examQuestions = pgTable(
  "exam_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    type: questionTypeEnum("type").notNull(),
    prompt: text("prompt").notNull(),
    // For multiple_choice: string[] of options. Null for other types.
    optionsJson: jsonb("options_json"),
    // Reference answer — only used by professor during grading, never sent to students
    referenceAnswer: text("reference_answer"),
    order: integer("order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("exam_questions_exam_order_idx").on(t.examId, t.order)]
).enableRLS();

// ─── Exam Submissions ─────────────────────────────────────────────────────────

export const examSubmissions = pgTable(
  "exam_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Professor-assigned grade and feedback after manual grading
    grade: real("grade"),
    feedback: text("feedback"),
    gradedAt: timestamp("graded_at", { withTimezone: true }),
    gradedBy: uuid("graded_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    // One submission per student per exam
    uniqueIndex("exam_submissions_student_exam_idx").on(t.studentId, t.examId),
  ]
).enableRLS();

// ─── Exam Answers ─────────────────────────────────────────────────────────────

export const examAnswers = pgTable("exam_answers", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => examSubmissions.id, { onDelete: "cascade" }),
  questionId: uuid("question_id")
    .notNull()
    .references(() => examQuestions.id, { onDelete: "cascade" }),
  answerText: text("answer_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

// ─── Assignments ──────────────────────────────────────────────────────────────

export const assignments = pgTable("assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

// ─── Assignment Submissions ───────────────────────────────────────────────────

export const assignmentSubmissions = pgTable(
  "assignment_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Supabase Storage path for the uploaded file
    fileStoragePath: text("file_storage_path"),
    grade: real("grade"),
    feedback: text("feedback"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    gradedAt: timestamp("graded_at", { withTimezone: true }),
    gradedBy: uuid("graded_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("assignment_submissions_student_assignment_idx").on(
      t.studentId,
      t.assignmentId
    ),
  ]
).enableRLS();

// ─── Forum Posts ──────────────────────────────────────────────────────────────

export const forumPosts = pgTable(
  "forum_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // A post is always tied to a course; optionally tied to a specific lecture
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    lectureId: uuid("lecture_id").references(() => lectures.id, {
      onDelete: "set null",
    }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("forum_posts_course_idx").on(t.courseId)]
).enableRLS();

// ─── Forum Replies ────────────────────────────────────────────────────────────

export const forumReplies = pgTable(
  "forum_replies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => forumPosts.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("forum_replies_post_idx").on(t.postId)]
).enableRLS();

// ─── Relations ────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  taughtCourses: many(courses),
  enrollments: many(enrollments),
  lectureProgress: many(lectureProgress),
  examSubmissions: many(examSubmissions),
  assignmentSubmissions: many(assignmentSubmissions),
  forumPosts: many(forumPosts),
  forumReplies: many(forumReplies),
}));

export const coursesRelations = relations(courses, ({ one, many }) => ({
  professor: one(users, { fields: [courses.professorId], references: [users.id] }),
  enrollments: many(enrollments),
  lectures: many(lectures),
  exams: many(exams),
  assignments: many(assignments),
  forumPosts: many(forumPosts),
}));

export const enrollmentsRelations = relations(enrollments, ({ one }) => ({
  student: one(users, { fields: [enrollments.studentId], references: [users.id] }),
  course: one(courses, { fields: [enrollments.courseId], references: [courses.id] }),
}));

export const lecturesRelations = relations(lectures, ({ one, many }) => ({
  course: one(courses, { fields: [lectures.courseId], references: [courses.id] }),
  progress: many(lectureProgress),
  forumPosts: many(forumPosts),
}));

export const lectureProgressRelations = relations(lectureProgress, ({ one }) => ({
  student: one(users, { fields: [lectureProgress.studentId], references: [users.id] }),
  lecture: one(lectures, { fields: [lectureProgress.lectureId], references: [lectures.id] }),
}));

export const examsRelations = relations(exams, ({ one, many }) => ({
  course: one(courses, { fields: [exams.courseId], references: [courses.id] }),
  questions: many(examQuestions),
  submissions: many(examSubmissions),
}));

export const examQuestionsRelations = relations(examQuestions, ({ one, many }) => ({
  exam: one(exams, { fields: [examQuestions.examId], references: [exams.id] }),
  answers: many(examAnswers),
}));

export const examSubmissionsRelations = relations(examSubmissions, ({ one, many }) => ({
  exam: one(exams, { fields: [examSubmissions.examId], references: [exams.id] }),
  student: one(users, { fields: [examSubmissions.studentId], references: [users.id] }),
  answers: many(examAnswers),
}));

export const examAnswersRelations = relations(examAnswers, ({ one }) => ({
  submission: one(examSubmissions, { fields: [examAnswers.submissionId], references: [examSubmissions.id] }),
  question: one(examQuestions, { fields: [examAnswers.questionId], references: [examQuestions.id] }),
}));

export const assignmentsRelations = relations(assignments, ({ one, many }) => ({
  course: one(courses, { fields: [assignments.courseId], references: [courses.id] }),
  submissions: many(assignmentSubmissions),
}));

export const assignmentSubmissionsRelations = relations(assignmentSubmissions, ({ one }) => ({
  assignment: one(assignments, { fields: [assignmentSubmissions.assignmentId], references: [assignments.id] }),
  student: one(users, { fields: [assignmentSubmissions.studentId], references: [users.id] }),
}));

export const forumPostsRelations = relations(forumPosts, ({ one, many }) => ({
  course: one(courses, { fields: [forumPosts.courseId], references: [courses.id] }),
  lecture: one(lectures, { fields: [forumPosts.lectureId], references: [lectures.id] }),
  author: one(users, { fields: [forumPosts.authorId], references: [users.id] }),
  replies: many(forumReplies),
}));

export const forumRepliesRelations = relations(forumReplies, ({ one }) => ({
  post: one(forumPosts, { fields: [forumReplies.postId], references: [forumPosts.id] }),
  author: one(users, { fields: [forumReplies.authorId], references: [users.id] }),
}));
