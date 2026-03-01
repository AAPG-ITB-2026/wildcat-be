import { pgTable, text, uuid, timestamp, boolean, pgEnum, real, jsonb, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ----------------------------------------------------------------------
// 1. ENUMS (Type Safety for Fixed Values)
// ----------------------------------------------------------------------
export const statusEnum = pgEnum('status', ['Registered', 'Document_Verified', 'Paid']);

export const categoryEnum = pgEnum('category', ['Wildcat', 'Smart_Competition', 'Paper_Competition']);

export const transactionStatusEnum = pgEnum('transaction_status', ['settlement', 'pending', 'deny', 'cancel', 'expire', 'failure']);

// ----------------------------------------------------------------------
// 2. CMS CONTENT (For BE-10 & BE-01)
// ----------------------------------------------------------------------
export const appContent = pgTable('app_content', {
  id: uuid('id').defaultRandom().primaryKey(),
  section: text('section').notNull().unique(), // e.g., 'hero', 'schedule'
  content: text('content').notNull(), // JSON stringified or generic text
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ----------------------------------------------------------------------
// 2b. APP CONFIG — Toggle flags 
// ----------------------------------------------------------------------
export const appConfig = pgTable('app_config', {
  key: text('key').primaryKey(),   // 'RELEASE_SCORES' | 'MAINTENANCE_MODE'
  value: text('value').notNull(),  // 'true' | 'false'
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ----------------------------------------------------------------------
// 2c. ANNOUNCEMENTS — Broadcast messages 
// ----------------------------------------------------------------------
export const announcements = pgTable('announcements', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  metadata: jsonb('metadata'),    // optional: { link, category, etc. }
  createdAt: timestamp('created_at').defaultNow(),
});

// ----------------------------------------------------------------------
// 3. TEAMS (The Core Table) [Source 164]
// ----------------------------------------------------------------------
export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(), // Links to Supabase auth.users (No FK constraint possible across schemas usually)
  
  teamName: text('team_name').notNull().unique(), // Source 136: "Team Name that already exists... warning"
  leaderName: text('leader_name').notNull(),
  university: text('university').notNull(),
  leaderMajor: text('leader_major').notNull(),
  
  category: categoryEnum('category').notNull(),
  status: statusEnum('status').default('Registered').notNull(),
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ----------------------------------------------------------------------
// 4. MEMBERS
// ----------------------------------------------------------------------
export const members = pgTable('members', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }).notNull(),
  fullName: text('full_name').notNull(),
  major: text('major').notNull(),
});
// NOTE: The "Max 2 Members" constraint is handled by a Database Trigger (BE-03), not schema definition.

// ----------------------------------------------------------------------
// 5. DOCUMENTS
// ----------------------------------------------------------------------
export const documents = pgTable('documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }).notNull(),
  
  fileUrl: text('file_url').notNull(), // Path in Supabase Storage
  isVerified: boolean('is_verified').default(false).notNull(),
  verifiedAt: timestamp('verified_at'),
  rejectionNote: text('rejection_note'), // "Reason if the document was rejected"
  
  createdAt: timestamp('created_at').defaultNow(),
});

// ----------------------------------------------------------------------
// 6. PAYMENTS
// ----------------------------------------------------------------------
export const payments = pgTable('payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }).notNull(),

  orderId: text('order_id').notNull().unique(), // Sent to Midtrans
  snapToken: text('snap_token'),
  creationTime: timestamp('creation_time').defaultNow().notNull(),
  expirationTime: timestamp('expiration_time').notNull(),
  transactionStatus: transactionStatusEnum('transaction_status').default('pending').notNull(),
  paymentType: text('payment_type'), // QRIS, VA, etc.
});

// ----------------------------------------------------------------------
// 7. SUBMISSIONS
// ----------------------------------------------------------------------
export const submissions = pgTable('submissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }).notNull(),
  
  submissionUrl: text('submission_url').notNull(),
  score: real('score'), // Float type
  feedback: text('feedback'),
  
  createdAt: timestamp('created_at').defaultNow(),
});

// ----------------------------------------------------------------------
// 8. RELATIONS (For easy querying)
// ----------------------------------------------------------------------
export const teamsRelations = relations(teams, ({ many }) => ({
  members: many(members),
  documents: many(documents),
  payments: many(payments),
  submissions: many(submissions),
}));

export const membersRelations = relations(members, ({ one }) => ({
  team: one(teams, {
    fields: [members.teamId],
    references: [teams.id],
  }),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  team: one(teams, {
    fields: [documents.teamId],
    references: [teams.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  team: one(teams, {
    fields: [payments.teamId],
    references: [teams.id],
  }),
}));

export const submissionsRelations = relations(submissions, ({ one }) => ({
  team: one(teams, {
    fields: [submissions.teamId],
    references: [teams.id],
  }),
}));