import { Hono } from 'hono';
import ExcelJS from 'exceljs';
import { eq, sql } from 'drizzle-orm';
import { createDb } from '../../db/index.js';
import {
  competitions,
  teamAccounts,
  events,
  eventRegistrationLog,
} from '../../db/schema.js';
import { committeeMiddleware } from '../../middlewares/auth.js';
import type { Env, Variables } from '../../types/index.js';

const exportRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/export/metrics-recap
// Generates a multi-sheet .xlsx workbook with competition, events, and
// daily growth curve data.
// Security: CommitteeAccount middleware (Admin or Committee roles)
// ─────────────────────────────────────────────────────────────────────────────
exportRouter.get(
  '/metrics-recap',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    try {
      const db = createDb(c.env);

    const competitionRows = await db
      .select({
        competitionName: competitions.name,
        teamCount: sql<number>`cast(count(${teamAccounts.id}) as integer)`,
      })
      .from(teamAccounts)
      .rightJoin(competitions, eq(teamAccounts.competitionId, competitions.id))
      .groupBy(competitions.id, competitions.name)
      .orderBy(competitions.name);

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
        date: sql<string>`to_char(date_trunc('day', ${eventRegistrationLog.createdAt}), 'YYYY-MM-DD')`,
        dailyCount: sql<number>`cast(count(${eventRegistrationLog.id}) as integer)`,
      })
      .from(eventRegistrationLog)
      .groupBy(sql`date_trunc('day', ${eventRegistrationLog.createdAt})`)
      .orderBy(sql`date_trunc('day', ${eventRegistrationLog.createdAt})`);

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
      { header: 'Registered Count', key: 'teamCount', width: 20 },
    ];
    sheet1.getRow(1).commit();
    styleHeader(sheet1.getRow(1));

    for (const row of competitionRows) {
      const dataRow = sheet1.addRow({
        competitionName: row.competitionName,
        teamCount: row.teamCount ?? 0,
      });
      dataRow.getCell('teamCount').alignment = { horizontal: 'center' };
    }

    const grandTotalCompetitions = competitionRows.reduce(
      (acc, r) => acc + (r.teamCount ?? 0),
      0,
    );
    const footerRow1 = sheet1.addRow({
      competitionName: 'GRAND TOTAL',
      teamCount: grandTotalCompetitions,
    });
    styleFooter(footerRow1);
    footerRow1.getCell('teamCount').alignment = { horizontal: 'center' };

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