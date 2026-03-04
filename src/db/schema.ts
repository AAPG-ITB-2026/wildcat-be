import {
    pgTable,
    uuid,
    varchar,
    text,
    timestamp,
    boolean,
    integer,
    decimal,
    doublePrecision,
    pgEnum,
    uniqueIndex,
} from "drizzle-orm/pg-core";

// ==========================================
// ENUMS
// ==========================================
export const roleEnum = pgEnum("role", ["Admin", "Committee"]);
export const verificationStatusEnum = pgEnum("verification_status", ["Pending", "Verified", "Rejected"]);
export const audienceEnum = pgEnum("target_audience", ["All", "Paper_Poster", "BCC", "GnG", "HighSchool"]);

// ==========================================
// 1. INTERNAL ADMINISTRATION
// ==========================================

export const committeeAccounts = pgTable("committee_accounts", {
    id: uuid("id").primaryKey().notNull(), // Maps to Supabase auth.users.id
    name: varchar("name", { length: 255 }).notNull(),
    role: roleEnum("role").notNull(),
    division: varchar("division", { length: 100 }).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
});

export const competitions = pgTable("competitions", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    minMembers: integer("min_members").notNull(),
    maxMembers: integer("max_members").notNull(),
    earlyBirdFee: decimal("early_bird_fee", { precision: 12, scale: 2 }).notNull(),
    normalBirdFee: decimal("normal_bird_fee", { precision: 12, scale: 2 }).notNull(),
    earlyBirdDeadline: timestamp("early_bird_deadline").notNull(),
    guidebookUrl: text("guidebook_url"), // Cloudflare R2 URL
});

// ==========================================
// 2. TIMELINE ENGINE
// ==========================================

export const competitionStages = pgTable("competition_stages", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    competitionId: uuid("competition_id").references(() => competitions.id).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date").notNull(),
});

export const stageRequirements = pgTable("stage_requirements", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    stageId: uuid("stage_id").references(() => competitionStages.id).notNull(),
    documentName: varchar("document_name", { length: 255 }).notNull(),
    allowedExtensions: varchar("allowed_extensions", { length: 100 }).notNull(),
    maxSizeMb: integer("max_size_mb").notNull(),
    isMandatory: boolean("is_mandatory").default(true).notNull(),
});

// ==========================================
// 3. ONBOARDING FUNNEL (PROFILE -> DOCS -> PAYMENT)
// ==========================================

export const teamAccounts = pgTable("team_accounts", {
    id: uuid("id").primaryKey().notNull(), // Maps to Supabase auth.users.id
    competitionId: uuid("competition_id").references(() => competitions.id).notNull(),
    currentStageId: uuid("current_stage_id").references(() => competitionStages.id),

    teamName: varchar("team_name", { length: 255 }).notNull(),
    institution: varchar("institution", { length: 255 }).notNull(),
    phoneNumber: varchar("phone_number", { length: 50 }).notNull(),
    lineId: varchar("line_id", { length: 100 }).notNull(),

    leadName: varchar("lead_name", { length: 255 }).notNull(),
    leadMajor: varchar("lead_major", { length: 255 }).notNull(),

    m1Name: varchar("m1_name", { length: 255 }),
    m1Major: varchar("m1_major", { length: 255 }),

    m2Name: varchar("m2_name", { length: 255 }),
    m2Major: varchar("m2_major", { length: 255 }),

    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const teamAdministration = pgTable("team_administration", {
    teamId: uuid("team_id").primaryKey().references(() => teamAccounts.id).notNull(), // Enforces 1:1 relation

    leadKtm: text("lead_ktm"), // Cloudflare R2 URLs (nullable for incremental uploads)
    m1Ktm: text("m1_ktm"),
    m2Ktm: text("m2_ktm"),
    twibbonProof: text("twibbon_proof"),
    posterProof: text("poster_proof"),

    verificationStatus: verificationStatusEnum("verification_status").default("Pending").notNull(),
    verifiedBy: uuid("verified_by").references(() => committeeAccounts.id),
    rejectionNotes: text("rejection_notes"),
});

export const transactions = pgTable("transactions", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    teamId: uuid("team_id").references(() => teamAccounts.id).notNull(),

    orderId: varchar("order_id", { length: 255 }).notNull(), // For Midtrans webhook mapping
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    paymentType: varchar("payment_type", { length: 100 }).notNull(),
    paymentProofUrl: text("payment_proof_url"), // Nullable for Midtrans auto-approvals

    verificationStatus: verificationStatusEnum("verification_status").default("Pending").notNull(),
    verifiedBy: uuid("verified_by").references(() => committeeAccounts.id),
    rejectionNotes: text("rejection_notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ==========================================
// 4. SUBMISSIONS & GRADING
// ==========================================

export const submissions = pgTable("submissions", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    teamId: uuid("team_id").references(() => teamAccounts.id).notNull(),
    requirementId: uuid("requirement_id").references(() => stageRequirements.id).notNull(),

    fileUrl: text("file_url").notNull(), // Cloudflare R2 URL
    isValid: boolean("is_valid").default(false).notNull(),
    verifiedBy: uuid("verified_by").references(() => committeeAccounts.id),
    submittedAt: timestamp("submitted_at").defaultNow().notNull(),
}, (table) => [
    uniqueIndex("submissions_team_requirement_idx").on(table.teamId, table.requirementId),
]);

export const stageScores = pgTable("stage_scores", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    teamId: uuid("team_id").references(() => teamAccounts.id).notNull(),
    stageId: uuid("stage_id").references(() => competitionStages.id).notNull(),

    finalScore: doublePrecision("final_score").notNull(),
    feedback: text("feedback"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ==========================================
// 5. DECOUPLED CMS & ANALYTICS
// ==========================================

export const events = pgTable("events", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    datetime: timestamp("datetime").notNull(),
    location: varchar("location", { length: 255 }).notNull(),
    speaker: varchar("speaker", { length: 255 }),
    registrationLink: text("registration_link").notNull(),

    isPublished: boolean("is_published").default(false).notNull(),
    authorId: uuid("author_id").references(() => committeeAccounts.id).notNull(),

    registeredCount: integer("registered_count").default(0).notNull(),
    attendedCount: integer("attended_count").default(0).notNull(),
});

export const announcements = pgTable("announcements", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    authorId: uuid("author_id").references(() => committeeAccounts.id).notNull(),

    title: varchar("title", { length: 255 }).notNull(),
    content: text("content").notNull(),
    targetAudience: audienceEnum("target_audience").notNull(),
    attachmentUrl: text("attachment_url"),

    scheduledFor: timestamp("scheduled_for"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});