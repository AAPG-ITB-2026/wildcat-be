import { Hono } from 'hono';
import ExcelJS from 'exceljs';
import { eq, sql } from 'drizzle-orm';
import { createDb } from '../../db/index.js';
import {
  competitions,
  teamAccounts,
  events,
  eventRegistrationLogs,
} from '../../db/schema.js';
import { committeeMiddleware } from '../../middlewares/auth.js';
import type { Env, Variables } from '../../types/index.js';

const exportRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/export/metrics-recap
// Generates a multi-sheet .xlsx workbook with competition, events, and
// daily growth curve data.
// Security: CommitteeAccount middleware (Admin or Committee roles)
//
// Description:
//   Exports comprehensive metrics into a formatted Excel workbook with three sheets:
//   
//   Sheet 1 - Competitions Recap:
//     - Team count per competition
//     - Participant count per competition (lead + members)
//     - Grand totals for both teams and participants
//     - Formatted with headers and footer summary row
//   
//   Sheet 2 - Events Recap:
//     - Event name, registered count, and attended count
//     - Grand totals for registrations and attendance
//     - Shows participation vs actual attendance rates
//   
//   Sheet 3 - Daily Growth Curve:
//     - Date-based breakdown of competition and event registrations
//     - Daily count for each category
//     - Cumulative running total to visualize growth trajectory
//     - Useful for analyzing marketing effectiveness and signup trends
//
// Response Format:
//   Returns an .xlsx file (Excel workbook) with formatted sheets, styled headers,
//   and footer rows with grand totals. File name: AAPG_Wildcat_Recap.xlsx
//
// Query Params: None
// Body: None
//
// Example File Structure:
//   Sheet 1 (Competitions Recap):
//     | Competition Name              | Team Count | Participant Count |
//     |-------------------------------|------------|--------------------|
//     | Paper and Poster...           | 45         | 98                 |
//     | Business Case Competition     | 38         | 87                 |
//     | GRAND TOTAL                   | 83         | 185                |
//
//   Sheet 2 (Events Recap):
//     | Event Name         | Registered Count | Attended Count |
//     |-------------------|------------------|----------------|
//     | Opening Ceremony   | 150              | 145            |
//     | GRAND TOTAL        | 500              | 480            |
//
//   Sheet 3 (Daily Growth Curve):
//     | Date       | Category                    | Daily Registrations | Cumulative Total |
//     |------------|-----------------------------|---------------------|------------------|
//     | 2024-01-15 | Paper & Poster (Competition)| 5                   | 45               |
//     | 2024-01-15 | Webinar (Event)             | 12                  | 57               |
// ─────────────────────────────────────────────────────────────────────────────
exportRouter.get(
  '/metrics-recap',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    try {
      const db = createDb(c.env);

    // Fetch all teams with member info to calculate participants
    const allTeams = await db
      .select({
        competitionId: teamAccounts.competitionId,
        competitionName: competitions.name,
        leadName: teamAccounts.leadName,
        m1Name: teamAccounts.m1Name,
        m2Name: teamAccounts.m2Name,
      })
      .from(teamAccounts)
      .rightJoin(competitions, eq(teamAccounts.competitionId, competitions.id))
      .orderBy(competitions.name);

    // Group by competition and calculate team & participant counts
    const competitionMap = new Map<string, {
      competitionName: string;
      teamCount: number;
      participantCount: number;
    }>();

    for (const team of allTeams) {
      if (!team.competitionId) continue; // Skip if no team in this competition

      const key = team.competitionId;
      if (!competitionMap.has(key)) {
        competitionMap.set(key, {
          competitionName: team.competitionName,
          teamCount: 0,
          participantCount: 0,
        });
      }

      const entry = competitionMap.get(key)!;
      entry.teamCount += 1;
      
      // Count participants: 1 (lead) + m1 (if exists) + m2 (if exists)
      let participantCount = 1; // Always has lead
      if (team.m1Name) participantCount += 1;
      if (team.m2Name) participantCount += 1;
      entry.participantCount += participantCount;
    }

    const competitionRows = Array.from(competitionMap.values());

    const eventRows = await db
      .select({
        name: events.name,
        registeredCount: events.registeredCount,
        attendedCount: events.attendedCount,
      })
      .from(events)
      .orderBy(events.name);

    const dailyCompetitionRows = await db
      .select({
        date: sql<string>`to_char(date_trunc('day', ${teamAccounts.createdAt}), 'YYYY-MM-DD')`,
        dailyCount: sql<number>`cast(count(${teamAccounts.id}) as integer)`,
      })
      .from(teamAccounts)
      .groupBy(sql`date_trunc('day', ${teamAccounts.createdAt})`)
      .orderBy(sql`date_trunc('day', ${teamAccounts.createdAt})`);

    const dailyEventRows = await db
      .select({
        date: sql<string>`to_char(date_trunc('day', ${eventRegistrationLogs.createdAt}), 'YYYY-MM-DD')`,
        dailyCount: sql<number>`cast(count(${eventRegistrationLogs.id}) as integer)`,
      })
      .from(eventRegistrationLogs)
      .groupBy(sql`date_trunc('day', ${eventRegistrationLogs.createdAt})`)
      .orderBy(sql`date_trunc('day', ${eventRegistrationLogs.createdAt})`);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'AAPG Wildcat ITB 2026';
    workbook.created = new Date();

    const styleHeader = (row: ExcelJS.Row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF1F4E79' },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
          top: { style: 'thin' },
          bottom: { style: 'thin' },
          left: { style: 'thin' },
          right: { style: 'thin' },
        };
      });
    };

    const styleFooter = (row: ExcelJS.Row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFDCE6F1' },
        };
        cell.border = {
          top: { style: 'medium' },
          bottom: { style: 'thin' },
          left: { style: 'thin' },
          right: { style: 'thin' },
        };
      });
    };

    // ════════════════════════════════════════════════════════════════════════
    // Sheet 1: Competitions Recap
    // ════════════════════════════════════════════════════════════════════════
    const sheet1 = workbook.addWorksheet('Competitions Recap');
    sheet1.columns = [
      { header: 'Competition Name', key: 'competitionName', width: 35 },
      { header: 'Team Count', key: 'teamCount', width: 18 },
      { header: 'Participant Count', key: 'participantCount', width: 20 },
    ];
    sheet1.getRow(1).commit();
    styleHeader(sheet1.getRow(1));

    for (const row of competitionRows) {
      const dataRow = sheet1.addRow({
        competitionName: row.competitionName,
        teamCount: row.teamCount ?? 0,
        participantCount: row.participantCount ?? 0,
      });
      dataRow.getCell('teamCount').alignment = { horizontal: 'center' };
      dataRow.getCell('participantCount').alignment = { horizontal: 'center' };
    }

    const grandTotalTeams = competitionRows.reduce(
      (acc, r) => acc + (r.teamCount ?? 0),
      0,
    );
    const grandTotalParticipants = competitionRows.reduce(
      (acc, r) => acc + (r.participantCount ?? 0),
      0,
    );
    const footerRow1 = sheet1.addRow({
      competitionName: 'GRAND TOTAL',
      teamCount: grandTotalTeams,
      participantCount: grandTotalParticipants,
    });
    styleFooter(footerRow1);
    footerRow1.getCell('teamCount').alignment = { horizontal: 'center' };
    footerRow1.getCell('participantCount').alignment = { horizontal: 'center' };

    // ════════════════════════════════════════════════════════════════════════
    // Sheet 2: Events Recap
    // ════════════════════════════════════════════════════════════════════════
    const sheet2 = workbook.addWorksheet('Events Recap');
    sheet2.columns = [
      { header: 'Event Name', key: 'name', width: 40 },
      { header: 'Registered Count', key: 'registeredCount', width: 20 },
      { header: 'Attended Count', key: 'attendedCount', width: 20 },
    ];
    sheet2.getRow(1).commit();
    styleHeader(sheet2.getRow(1));

    for (const row of eventRows) {
      const dataRow = sheet2.addRow({
        name: row.name,
        registeredCount: row.registeredCount,
        attendedCount: row.attendedCount,
      });
      dataRow.getCell('registeredCount').alignment = { horizontal: 'center' };
      dataRow.getCell('attendedCount').alignment = { horizontal: 'center' };
    }

    const grandTotalRegistered = eventRows.reduce((acc, r) => acc + r.registeredCount, 0);
    const grandTotalAttended = eventRows.reduce((acc, r) => acc + r.attendedCount, 0);
    const footerRow2 = sheet2.addRow({
      name: 'GRAND TOTAL',
      registeredCount: grandTotalRegistered,
      attendedCount: grandTotalAttended,
    });
    styleFooter(footerRow2);
    footerRow2.getCell('registeredCount').alignment = { horizontal: 'center' };
    footerRow2.getCell('attendedCount').alignment = { horizontal: 'center' };

    // ════════════════════════════════════════════════════════════════════════
    // Sheet 3: Daily Growth Curve
    // Merges competition and event daily registrations with cumulative totals
    // ════════════════════════════════════════════════════════════════════════
    const sheet3 = workbook.addWorksheet('Daily Growth Curve');
    sheet3.columns = [
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Category', key: 'category', width: 25 },
      { header: 'Daily Registrations', key: 'dailyCount', width: 22 },
      { header: 'Cumulative Total', key: 'cumulative', width: 20 },
    ];
    sheet3.getRow(1).commit();
    styleHeader(sheet3.getRow(1));

    type GrowthRow = {
      date: string;
      category: string;
      dailyCount: number;
    };

    const growthRows: GrowthRow[] = [
      ...dailyCompetitionRows.map((r) => ({
        date: r.date,
        category: 'Paper & Poster (Competition)',
        dailyCount: r.dailyCount ?? 0,
      })),
      ...dailyEventRows.map((r) => ({
        date: r.date,
        category: 'Webinar (Event)',
        dailyCount: r.dailyCount ?? 0,
      })),
    ].sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date);
      return dateCmp !== 0 ? dateCmp : a.category.localeCompare(b.category);
    });

    let cumulative = 0;
    for (const row of growthRows) {
      cumulative += row.dailyCount;
      const dataRow = sheet3.addRow({
        date: row.date,
        category: row.category,
        dailyCount: row.dailyCount,
        cumulative,
      });
      dataRow.getCell('dailyCount').alignment = { horizontal: 'center' };
      dataRow.getCell('cumulative').alignment = { horizontal: 'center' };
    }

    const buffer = await workbook.xlsx.writeBuffer() as ArrayBuffer;

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="AAPG_Wildcat_Recap.xlsx"',
      },
    });
  } catch (err) {
    console.error('[export/metrics-recap]', err);
    return c.json({ error: 'Failed to generate export' }, 500);
  }
  },
);

export default exportRouter;
