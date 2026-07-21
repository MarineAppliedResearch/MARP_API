const express = require("express");
const { query } = require("./db");
const router = express.Router();

router.get("/reporting/ping", async (_req, res) => {
  try {
    const info = await query(`select current_user, current_database(), now() as server_time`);
    const tables = await query(`select tablename from pg_tables where schemaname='public' order by tablename limit 10`);
    res.json({ ok: true, info: info.rows[0], tables: tables.rows.map(r => r.tablename) });
  } catch (e) {
    console.error("[/reporting/ping] error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});


// --- Survey Effort (YTD) KPI ---
// POST /api/reporting/kpi/effort
// Body (all optional):
// {
//   "year": 2025,                           // default = current year on server
//   "implementationRegion": "Central",      // exact match
//   "site": "Point Lobos",                  // exact match
//   "mpaGroup": "Monterey Peninsula",       // exact match
//   "designation": "SMR",                   // 'SMR' | 'SMCA' | 'Reference'
//   "includeOffTransect": false,            // default false
//   "minUsableArea": 0                      // default 0
// }
router.post("/reporting/kpi/effort", async (req, res) => {
  try {
    const {
      year, implementationRegion, site, mpaGroup, designation,
      includeOffTransect = false,
      minUsableArea = 0
    } = req.body || {};

    // Derive the anchor year (defaults to server current year)
    const y = Number.isInteger(year) ? year : new Date().getFullYear();

    // Build parameter array (keep order aligned with SQL $1..$8)
    const params = [
      `${y}-01-01`,                // $1 anchor year start (ISO is fine for timestamptz cast)
      implementationRegion ?? null,// $2
      site ?? null,                // $3
      mpaGroup ?? null,            // $4
      designation ?? null,         // $5
      includeOffTransect ? 1 : 0,  // $6 toggle
      Number(minUsableArea) || 0,  // $7 min area
      `${y - 1}-01-01`             // $8 previous year start
    ];

    const sql = `
      WITH base AS (
        SELECT
          ra."Transect_ID",
          SUM(COALESCE(ra."Usable_Area", 0)) AS area_sum,
          BOOL_OR(COALESCE(ra."Off_Transect", 0) > 0) AS any_off
        FROM public.rovanalysis ra
        WHERE ra."SurveyDate" >= DATE_TRUNC('year', $1::timestamptz)
          AND ra."SurveyDate" <  DATE_TRUNC('year', $1::timestamptz) + INTERVAL '1 year'
          AND ($2::text IS NULL OR ra."Implementation_Region" = $2)
          AND ($3::text IS NULL OR ra."Site" = $3)
          AND ($4::text IS NULL OR ra."MPAGroup" = $4)
          AND ($5::text IS NULL OR ra."Designation" = $5)
        GROUP BY ra."Transect_ID"
      ),
      completed AS (
        SELECT *
        FROM base
        WHERE area_sum >= $7
          AND ( $6 = 1 OR NOT any_off ) -- exclude off-transect unless includeOffTransect=true
      ),
      base_prev AS (
        SELECT
          ra."Transect_ID",
          SUM(COALESCE(ra."Usable_Area", 0)) AS area_sum,
          BOOL_OR(COALESCE(ra."Off_Transect", 0) > 0) AS any_off
        FROM public.rovanalysis ra
        WHERE ra."SurveyDate" >= DATE_TRUNC('year', $8::timestamptz)
          AND ra."SurveyDate" <  DATE_TRUNC('year', $8::timestamptz) + INTERVAL '1 year'
          AND ($2::text IS NULL OR ra."Implementation_Region" = $2)
          AND ($3::text IS NULL OR ra."Site" = $3)
          AND ($4::text IS NULL OR ra."MPAGroup" = $4)
          AND ($5::text IS NULL OR ra."Designation" = $5)
        GROUP BY ra."Transect_ID"
      ),
      completed_prev AS (
        SELECT *
        FROM base_prev
        WHERE area_sum >= $7
          AND ( $6 = 1 OR NOT any_off )
      )
      SELECT
        $1::date                                         AS anchor_year_start,
        EXTRACT(YEAR FROM $1::date)::int                 AS year,
        (SELECT COUNT(*)               FROM completed)   AS transects_ytd,
        (SELECT COALESCE(SUM(area_sum),0) FROM completed)     AS usable_area_ytd,
        (SELECT COUNT(*)               FROM completed_prev)   AS transects_prev,
        (SELECT COALESCE(SUM(area_sum),0) FROM completed_prev) AS usable_area_prev
      ;
    `;

    const { rows } = await query(sql, params);
    const row = rows[0];

    // calculate deltas safely
    const dTransects = row.transects_prev ? (row.transects_ytd - row.transects_prev) / row.transects_prev : null;
    const dArea      = row.usable_area_prev ? (row.usable_area_ytd - row.usable_area_prev) / row.usable_area_prev : null;

    res.json({
      meta: {
        id: "kpi_effort",
        title: "Survey Effort (YTD)",
        filters: { year: y, implementationRegion, site, mpaGroup, designation, includeOffTransect, minUsableArea }
      },
      data: {
        year: row.year,
        transects_ytd: Number(row.transects_ytd),
        usable_area_ytd: Number(row.usable_area_ytd),
        previous_year: y - 1,
        transects_prev: Number(row.transects_prev),
        usable_area_prev: Number(row.usable_area_prev),
        delta_transects_pct: dTransects === null ? null : Number((dTransects * 100).toFixed(1)),
        delta_area_pct: dArea === null ? null : Number((dArea * 100).toFixed(1))
      }
    });
  } catch (e) {
    console.error("[/reporting/kpi/effort] error", e);
    res.status(400).json({ error: e.message || "KPI query failed" });
  }
});

module.exports = router;
