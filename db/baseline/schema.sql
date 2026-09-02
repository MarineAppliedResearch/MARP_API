--
-- MARP baseline schema.
--
-- This file exists because the migrations in this repository cannot build a
-- database from nothing. `observations`, `projects`, `sessions` and
-- `metaInfos` have no createTable migration anywhere -- they predate the
-- migration history and every migration that touches them assumes they are
-- already there. So a fresh, empty database could not be brought up at all,
-- and nobody could stand up a working MARP without being handed a copy of
-- someone else's database.
--
-- This is the starting point those migrations assume: a schema-only dump of
-- the production database, which is the authoritative shape. Restore it into
-- an empty database, then run `npx sequelize-cli db:migrate` to apply the
-- migrations it predates.
--
-- Contains no observation data. Tables, views, indexes, constraints and one
-- enum type only.
--
-- Provenance
-- ----------
--   Source:   production mare_v1, PostgreSQL 14.24
--   Captured: 2026-09-02
--   Command:  pg_dump --schema-only --no-owner --no-privileges
--   Contents: 23 tables, 4 views
--
-- Verified on capture: restoring this into an empty PostgreSQL 18.6 and
-- running the 19 migrations the baseline predates produces a schema identical
-- to the development server's -- 35 tables and views, 447 columns, 77 indexes,
-- 204 constraints and 4 view definitions all matching.
--
-- Regenerating
-- ------------
-- Re-dump from production with the command above, then strip the two
-- `\restrict` / `\unrestrict` lines pg_dump emits. Those are psql
-- meta-commands, and removing them keeps this file plain SQL so
-- `scripts/init-database.js` can execute it through the `pg` driver without
-- psql being installed. They guard an interactive restore against hostile
-- object names in an untrusted dump; this file is committed and reviewable,
-- so that protection is not doing anything here.
--
-- Do not hand-edit the schema below. Change it with a migration, the way
-- every other schema change in this repository is made.
--

--
-- PostgreSQL database dump
--


-- Dumped from database version 14.24 (Ubuntu 14.24-0ubuntu0.22.04.1)
-- Dumped by pg_dump version 14.24 (Ubuntu 14.24-0ubuntu0.22.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: enum_keyframes_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_keyframes_type AS ENUM (
    'start',
    'middle',
    'end'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: SequelizeMeta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SequelizeMeta" (
    name character varying(255) NOT NULL
);


--
-- Name: artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artifacts (
    id integer NOT NULL,
    training_run_id integer NOT NULL,
    artifact_type character varying(255) NOT NULL,
    path character varying(255) NOT NULL,
    size_mb double precision,
    hash character varying(255),
    metadata jsonb,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: TABLE artifacts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.artifacts IS 'Tracks files and outputs produced during a training run, including weights, logs, and result visualizations.';


--
-- Name: COLUMN artifacts.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.artifacts.id IS 'Unique identifier for this artifact record.';


--
-- Name: COLUMN artifacts.training_run_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.artifacts.training_run_id IS 'Foreign key referencing the training run this artifact belongs to (training_runs.id).';


--
-- Name: COLUMN artifacts.artifact_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.artifacts.artifact_type IS 'Type of artifact (e.g., "weights", "log", "results_plot", "confusion_matrix", "export").';


--
-- Name: COLUMN artifacts.path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.artifacts.path IS 'Filesystem path or URI to the artifact file or directory.';


--
-- Name: COLUMN artifacts.size_mb; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.artifacts.size_mb IS 'File size in megabytes, if available (useful for monitoring disk usage).';


--
-- Name: COLUMN artifacts.hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.artifacts.hash IS 'Checksum or hash of the artifact file (e.g., SHA256) to verify integrity and detect duplicates.';


--
-- Name: COLUMN artifacts.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.artifacts.metadata IS 'Optional JSON metadata with contextual information (e.g., epoch number, export format, or framework version).';


--
-- Name: COLUMN artifacts.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.artifacts.created_at IS 'Timestamp when this artifact record was created (typically when the file was generated).';


--
-- Name: COLUMN artifacts.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.artifacts.updated_at IS 'Timestamp when this artifact record was last updated.';


--
-- Name: artifacts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.artifacts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: artifacts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.artifacts_id_seq OWNED BY public.artifacts.id;


--
-- Name: dataset_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dataset_observations (
    id integer NOT NULL,
    dataset_id integer NOT NULL,
    observation_id integer NOT NULL,
    inclusion_type character varying(255),
    selection_method character varying(255),
    weight double precision,
    notes text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: TABLE dataset_observations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.dataset_observations IS 'Join table linking datasets and observations, including inclusion type and selection metadata for traceability.';


--
-- Name: COLUMN dataset_observations.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dataset_observations.id IS 'Unique identifier for this dataset-observation record.';


--
-- Name: COLUMN dataset_observations.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dataset_observations.dataset_id IS 'Foreign key referencing the dataset that includes this observation (datasets.id).';


--
-- Name: COLUMN dataset_observations.observation_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dataset_observations.observation_id IS 'Foreign key referencing the observation included in this dataset (observations.observation_id).';


--
-- Name: COLUMN dataset_observations.inclusion_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dataset_observations.inclusion_type IS 'Indicates how this observation is used in the dataset: "train", "val", or "test".';


--
-- Name: COLUMN dataset_observations.selection_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dataset_observations.selection_method IS 'Describes how this observation was chosen for inclusion (e.g., "manual", "auto", "random_sample", "legacy_import").';


--
-- Name: COLUMN dataset_observations.weight; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dataset_observations.weight IS 'Optional weighting factor applied to this observation within the dataset for class balancing or sampling probability.';


--
-- Name: COLUMN dataset_observations.notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dataset_observations.notes IS 'Freeform notes about this dataset-observation inclusion (e.g., reasons for inclusion/exclusion, data quality remarks).';


--
-- Name: COLUMN dataset_observations.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dataset_observations.created_at IS 'Timestamp when this dataset-observation record was created.';


--
-- Name: COLUMN dataset_observations.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dataset_observations.updated_at IS 'Timestamp when this dataset-observation record was last updated.';


--
-- Name: dataset_observations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dataset_observations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dataset_observations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dataset_observations_id_seq OWNED BY public.dataset_observations.id;


--
-- Name: datasets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.datasets (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    location character varying(255),
    num_samples integer,
    num_classes integer,
    source character varying(255),
    notes text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: COLUMN datasets.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.datasets.id IS 'Unique identifier for this dataset record.';


--
-- Name: COLUMN datasets.name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.datasets.name IS 'Descriptive name of this dataset (e.g., "Fish_2024_Training_Set_v1").';


--
-- Name: COLUMN datasets.description; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.datasets.description IS 'Detailed description or notes about the dataset’s purpose and composition.';


--
-- Name: COLUMN datasets.location; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.datasets.location IS 'Filesystem or network location of the dataset resources.';


--
-- Name: COLUMN datasets.num_samples; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.datasets.num_samples IS 'Total number of samples (images, frames, or observations) included in this dataset.';


--
-- Name: COLUMN datasets.num_classes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.datasets.num_classes IS 'Approximate number of unique species/classes represented in this dataset (derived from observation comnames).';


--
-- Name: COLUMN datasets.source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.datasets.source IS 'Source or method of dataset creation (e.g., "auto-compiled", "manual curation", "legacy import").';


--
-- Name: COLUMN datasets.notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.datasets.notes IS 'General notes about dataset preparation, inclusion criteria, or issues.';


--
-- Name: COLUMN datasets.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.datasets.created_at IS 'Timestamp when this dataset record was created.';


--
-- Name: COLUMN datasets.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.datasets.updated_at IS 'Timestamp when this dataset record was last updated.';


--
-- Name: datasets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.datasets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: datasets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.datasets_id_seq OWNED BY public.datasets.id;


--
-- Name: epochs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.epochs (
    id integer NOT NULL,
    training_run_id integer NOT NULL,
    epoch_number integer NOT NULL,
    start_time timestamp with time zone,
    end_time timestamp with time zone,
    duration_seconds double precision,
    "precision" double precision,
    recall double precision,
    map50 double precision,
    map5095 double precision,
    box_loss double precision,
    cls_loss double precision,
    dfl_loss double precision,
    "timestamp" timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: COLUMN epochs.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.epochs.id IS 'Unique identifier for this epoch record.';


--
-- Name: COLUMN epochs.training_run_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.epochs.training_run_id IS 'Foreign key linking this epoch to its parent training run (training_runs.id).';


--
-- Name: COLUMN epochs.epoch_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.epochs.epoch_number IS 'The ordinal number of this epoch in the training sequence.';


--
-- Name: COLUMN epochs.start_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.epochs.start_time IS 'Timestamp marking when this epoch began processing.';


--
-- Name: COLUMN epochs.end_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.epochs.end_time IS 'Timestamp marking when this epoch completed.';


--
-- Name: COLUMN epochs.duration_seconds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.epochs.duration_seconds IS 'Total elapsed time of this epoch, in seconds (end_time - start_time).';


--
-- Name: COLUMN epochs."precision"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.epochs."precision" IS 'Precision metric value recorded at the end of this epoch.';


--
-- Name: COLUMN epochs.recall; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.epochs.recall IS 'Recall metric value recorded at the end of this epoch.';


--
-- Name: COLUMN epochs.map50; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.epochs.map50 IS 'Mean Average Precision (mAP) at 0.5 IoU threshold for this epoch.';


--
-- Name: COLUMN epochs.map5095; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.epochs.map5095 IS 'Mean Average Precision (mAP) averaged across IoU thresholds 0.5–0.95 for this epoch.';


--
-- Name: COLUMN epochs.box_loss; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.epochs.box_loss IS 'Loss associated with bounding box coordinate regression during this epoch.';


--
-- Name: COLUMN epochs.cls_loss; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.epochs.cls_loss IS 'Loss associated with class label predictions during this epoch.';


--
-- Name: COLUMN epochs.dfl_loss; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.epochs.dfl_loss IS 'Distribution Focal Loss (DFL) for this epoch, if applicable to the model type.';


--
-- Name: COLUMN epochs."timestamp"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.epochs."timestamp" IS 'Timestamp when this epoch record was inserted into the database.';


--
-- Name: COLUMN epochs.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.epochs.created_at IS 'Timestamp when this epoch record was created.';


--
-- Name: COLUMN epochs.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.epochs.updated_at IS 'Timestamp when this epoch record was last updated.';


--
-- Name: epochs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.epochs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: epochs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.epochs_id_seq OWNED BY public.epochs.id;


--
-- Name: observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.observations (
    observation_id integer NOT NULL,
    project_id integer,
    session_id integer,
    user_id integer,
    tc character varying(255),
    frame character varying(255),
    taxserial integer,
    comname character varying(255),
    count integer,
    quadrant integer,
    etc character varying(255),
    note character varying(255),
    timelog character varying(255),
    video_source character varying(255),
    "videoLocation" character varying(255),
    "mediaPosition" character varying(255),
    "actualPosition" character varying(255),
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    sex character varying(255),
    coarsesize integer,
    "taxReview" character varying(255),
    downcamera character varying(255),
    sizereview integer,
    "obsID" integer NOT NULL,
    substrate_bedrock boolean,
    substrate_megaclast boolean,
    substrate_boulder boolean,
    substrate_cobble boolean,
    substrate_pebble boolean,
    substrate_granule boolean,
    substrate_sand boolean,
    substrate_mud boolean,
    substrate_coral_reef boolean,
    substrate_coral_rubble boolean,
    substrate_shell_hash boolean,
    substrate_shell_rubble boolean,
    substrate_algal boolean,
    "PobsID" integer,
    confidence double precision
);


--
-- Name: COLUMN observations.confidence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.observations.confidence IS 'Confidence score (0.0–1.0) associated with this observation.';


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    project_id integer NOT NULL,
    name character varying(255) NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    session_id integer NOT NULL,
    project_id integer,
    user_id integer,
    dive character varying(255) NOT NULL,
    line character varying(255) NOT NULL,
    "lineId" character varying(255) NOT NULL,
    type character varying(255) NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id integer NOT NULL,
    name character varying(255) NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


--
-- Name: habitat_report; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.habitat_report AS
 SELECT projects.name AS "Project Name",
    users.name AS "Processor Name",
    sessions.type AS "Session Type",
    observations.observation_id,
    observations."obsID",
    observations."PobsID",
    sessions.session_id AS "Session Number",
    observations.comname AS "Substrate",
    observations.coarsesize AS "PCTcover",
    observations.tc,
    observations.etc,
    sessions.dive,
    sessions.line,
    sessions."lineId",
    observations.note,
    observations."updatedAt",
    observations.video_source,
    observations."videoLocation",
    observations."mediaPosition",
    observations."actualPosition"
   FROM public.observations,
    public.projects,
    public.sessions,
    public.users
  WHERE ((sessions.user_id = users.user_id) AND (sessions.session_id = observations.session_id) AND (sessions.project_id = projects.project_id) AND ((sessions.type)::text = 'Habitat'::text))
  ORDER BY sessions.session_id, observations."obsID";


--
-- Name: hyperparameters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hyperparameters (
    id integer NOT NULL,
    training_run_id integer NOT NULL,
    params jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: TABLE hyperparameters; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hyperparameters IS 'Stores full hyperparameter configurations for each training run to ensure reproducibility and comparability.';


--
-- Name: COLUMN hyperparameters.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hyperparameters.id IS 'Unique identifier for this hyperparameter configuration.';


--
-- Name: COLUMN hyperparameters.training_run_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hyperparameters.training_run_id IS 'Foreign key referencing the training run this hyperparameter set belongs to (training_runs.id).';


--
-- Name: COLUMN hyperparameters.params; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hyperparameters.params IS 'JSON object containing all hyperparameters used for this training run (e.g., lr0, momentum, epochs, etc.).';


--
-- Name: COLUMN hyperparameters.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hyperparameters.created_at IS 'Timestamp when this hyperparameter record was created.';


--
-- Name: COLUMN hyperparameters.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hyperparameters.updated_at IS 'Timestamp when this hyperparameter record was last updated.';


--
-- Name: hyperparameters_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hyperparameters_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hyperparameters_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hyperparameters_id_seq OWNED BY public.hyperparameters.id;


--
-- Name: keyframes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.keyframes (
    keyframe_id integer NOT NULL,
    observation_id integer NOT NULL,
    subset character varying(255) NOT NULL,
    comname character varying(255) NOT NULL,
    type character varying(255) NOT NULL,
    framenum integer NOT NULL,
    x double precision NOT NULL,
    y double precision NOT NULL,
    width double precision NOT NULL,
    height double precision NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    confidence double precision
);


--
-- Name: COLUMN keyframes.confidence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.keyframes.confidence IS 'Confidence score (0.0–1.0) for this annotation keyframe.';


--
-- Name: keyframes_keyframe_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.keyframes_keyframe_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: keyframes_keyframe_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.keyframes_keyframe_id_seq OWNED BY public.keyframes.keyframe_id;


--
-- Name: marinedebris_report; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.marinedebris_report AS
 SELECT projects.name AS "Project Name",
    users.name AS "Processor Name",
    sessions.type AS "Session Type",
    observations.observation_id,
    observations."obsID",
    observations."PobsID",
    sessions.session_id AS "Session Number",
    observations.tc,
    observations.etc,
    observations.frame,
    observations.comname,
    observations.taxserial,
    observations.count,
    observations."taxReview",
    observations.note
   FROM public.observations,
    public.projects,
    public.sessions,
    public.users
  WHERE ((sessions.user_id = users.user_id) AND (sessions.session_id = observations.session_id) AND (sessions.project_id = projects.project_id) AND ((sessions.type)::text = 'MarineDebris'::text))
  ORDER BY sessions.session_id, observations."obsID";


--
-- Name: metaInfos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."metaInfos" (
    id integer NOT NULL,
    "createdAt" timestamp with time zone DEFAULT '2023-02-28 19:34:53.253+00'::timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT '2023-02-28 19:34:53.253+00'::timestamp with time zone NOT NULL,
    name character varying(255) NOT NULL
);


--
-- Name: metaInfos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."metaInfos_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: metaInfos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."metaInfos_id_seq" OWNED BY public."metaInfos".id;


--
-- Name: metrics_curves; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metrics_curves (
    id integer NOT NULL,
    metrics_summary_id integer NOT NULL,
    species_id integer,
    confidence_threshold double precision NOT NULL,
    "precision" double precision,
    recall double precision,
    f1_score double precision,
    support integer,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: COLUMN metrics_curves.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_curves.id IS 'Unique identifier for this metrics curve data point.';


--
-- Name: COLUMN metrics_curves.metrics_summary_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_curves.metrics_summary_id IS 'Foreign key referencing the metrics summary record (metrics_summary.id) this curve point belongs to.';


--
-- Name: COLUMN metrics_curves.species_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_curves.species_id IS 'Foreign key referencing the species this summary applies to. NULL means it represents an aggregate across all species.';


--
-- Name: COLUMN metrics_curves.confidence_threshold; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_curves.confidence_threshold IS 'Confidence threshold (between 0.0 and 1.0) at which these metrics were measured.';


--
-- Name: COLUMN metrics_curves."precision"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_curves."precision" IS 'Model precision value computed at this confidence threshold.';


--
-- Name: COLUMN metrics_curves.recall; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_curves.recall IS 'Model recall value computed at this confidence threshold.';


--
-- Name: COLUMN metrics_curves.f1_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_curves.f1_score IS 'Model F1 score computed at this confidence threshold.';


--
-- Name: COLUMN metrics_curves.support; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_curves.support IS 'Number of predictions or detections evaluated at this confidence threshold.';


--
-- Name: COLUMN metrics_curves.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_curves.created_at IS 'Timestamp when this metrics curve record was created.';


--
-- Name: COLUMN metrics_curves.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_curves.updated_at IS 'Timestamp when this metrics curve record was last updated.';


--
-- Name: metrics_curves_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.metrics_curves_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: metrics_curves_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.metrics_curves_id_seq OWNED BY public.metrics_curves.id;


--
-- Name: metrics_summary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metrics_summary (
    id integer NOT NULL,
    training_run_id integer NOT NULL,
    species_id integer,
    dataset_split character varying(255) NOT NULL,
    "precision" double precision,
    recall double precision,
    map50 double precision,
    map5095 double precision,
    fitness double precision,
    f1_score double precision,
    confusion_matrix_path character varying(255),
    result_plot_path character varying(255),
    confusion_matrix_norm_path character varying(255),
    box_f1_curve_path character varying(255),
    box_p_curve_path character varying(255),
    box_pr_curve_path character varying(255),
    box_r_curve_path character varying(255),
    labels_plot_path character varying(255),
    details jsonb,
    "timestamp" timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: COLUMN metrics_summary.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary.id IS 'Unique identifier for this metrics summary record.';


--
-- Name: COLUMN metrics_summary.training_run_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary.training_run_id IS 'Foreign key referencing the training run this metrics summary belongs to (training_runs.id).';


--
-- Name: COLUMN metrics_summary.species_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary.species_id IS 'Foreign key referencing the species this summary applies to. NULL means it represents an aggregate across all species.';


--
-- Name: COLUMN metrics_summary.dataset_split; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary.dataset_split IS 'Specifies which dataset split these metrics apply to: "train", "val", or "test".';


--
-- Name: COLUMN metrics_summary."precision"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary."precision" IS 'Aggregate precision achieved for this dataset split.';


--
-- Name: COLUMN metrics_summary.recall; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary.recall IS 'Aggregate recall achieved for this dataset split.';


--
-- Name: COLUMN metrics_summary.map50; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary.map50 IS 'Mean Average Precision (mAP) at 0.5 IoU threshold for this split.';


--
-- Name: COLUMN metrics_summary.map5095; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary.map5095 IS 'Mean Average Precision (mAP) averaged over IoU thresholds 0.5–0.95.';


--
-- Name: COLUMN metrics_summary.fitness; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary.fitness IS 'Weighted performance score used by YOLO to rank model checkpoints.';


--
-- Name: COLUMN metrics_summary.f1_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary.f1_score IS 'Aggregate F1 score for this dataset split, typically computed from precision and recall.';


--
-- Name: COLUMN metrics_summary.confusion_matrix_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary.confusion_matrix_path IS 'Filesystem path or URI to the confusion matrix image generated for this dataset split.';


--
-- Name: COLUMN metrics_summary.result_plot_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary.result_plot_path IS 'Filesystem path or URI to the overall results plot (e.g., PR or F1 curves) for this dataset split.';


--
-- Name: COLUMN metrics_summary.confusion_matrix_norm_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary.confusion_matrix_norm_path IS 'Path to the normalized confusion matrix plot image generated during evaluation.';


--
-- Name: COLUMN metrics_summary.box_f1_curve_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary.box_f1_curve_path IS 'Path to the F1 vs confidence curve plot image.';


--
-- Name: COLUMN metrics_summary.box_p_curve_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary.box_p_curve_path IS 'Path to the precision vs confidence curve plot image.';


--
-- Name: COLUMN metrics_summary.box_pr_curve_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary.box_pr_curve_path IS 'Path to the precision–recall (PR) curve plot image.';


--
-- Name: COLUMN metrics_summary.box_r_curve_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary.box_r_curve_path IS 'Path to the recall vs confidence curve plot image.';


--
-- Name: COLUMN metrics_summary.labels_plot_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary.labels_plot_path IS 'Path to the label distribution plot image showing class balance in the dataset.';


--
-- Name: COLUMN metrics_summary.details; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary.details IS 'Optional JSON object storing additional data arrays (e.g., per-class metrics or PR/F1-confidence points).';


--
-- Name: COLUMN metrics_summary."timestamp"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary."timestamp" IS 'Timestamp when this metrics summary was created or finalized.';


--
-- Name: COLUMN metrics_summary.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary.created_at IS 'Record creation timestamp.';


--
-- Name: COLUMN metrics_summary.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metrics_summary.updated_at IS 'Record last update timestamp.';


--
-- Name: metrics_summary_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.metrics_summary_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: metrics_summary_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.metrics_summary_id_seq OWNED BY public.metrics_summary.id;


--
-- Name: ml_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ml_models (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    parent_model_id integer,
    model_type character varying(255) NOT NULL,
    architecture_version character varying(255),
    storage_path character varying(255),
    status character varying(255) DEFAULT 'draft'::character varying NOT NULL,
    notes text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: COLUMN ml_models.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ml_models.id IS 'Unique numeric identifier for this ML model record.';


--
-- Name: COLUMN ml_models.name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ml_models.name IS 'Human-readable name (e.g., "yolov8-marine-fish-2025").';


--
-- Name: COLUMN ml_models.parent_model_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ml_models.parent_model_id IS 'Optional self-reference for lineage.';


--
-- Name: COLUMN ml_models.model_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ml_models.model_type IS 'Architecture family (e.g., "yolov8", "resnet").';


--
-- Name: COLUMN ml_models.architecture_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ml_models.architecture_version IS 'Architecture variant/version (e.g., "v8n", "2025a").';


--
-- Name: COLUMN ml_models.storage_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ml_models.storage_path IS 'Path/URI to weights and artifacts.';


--
-- Name: COLUMN ml_models.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ml_models.status IS 'Lifecycle: "draft" | "training" | "trained" | "archived".';


--
-- Name: COLUMN ml_models.notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ml_models.notes IS 'Freeform notes.';


--
-- Name: ml_models_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ml_models_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ml_models_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ml_models_id_seq OWNED BY public.ml_models.id;


--
-- Name: model_species; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_species (
    id integer NOT NULL,
    model_id integer NOT NULL,
    species_id integer NOT NULL,
    dataset_size integer,
    balance_weight double precision,
    precision_mean double precision,
    recall_mean double precision,
    f1_mean double precision,
    notes text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: COLUMN model_species.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.model_species.id IS 'Unique numeric identifier for this model-species linkage record.';


--
-- Name: COLUMN model_species.model_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.model_species.model_id IS 'Foreign key referencing the associated ML model (ml_models.id).';


--
-- Name: COLUMN model_species.species_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.model_species.species_id IS 'Foreign key referencing the species this model was trained on (species.id).';


--
-- Name: COLUMN model_species.dataset_size; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.model_species.dataset_size IS 'Number of image or annotation samples of this species used for training this model.';


--
-- Name: COLUMN model_species.balance_weight; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.model_species.balance_weight IS 'Relative weight used for balancing this species during training (higher = more importance).';


--
-- Name: COLUMN model_species.precision_mean; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.model_species.precision_mean IS 'Mean precision achieved by the model for this species during evaluation (optional).';


--
-- Name: COLUMN model_species.recall_mean; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.model_species.recall_mean IS 'Mean recall achieved by the model for this species during evaluation (optional).';


--
-- Name: COLUMN model_species.f1_mean; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.model_species.f1_mean IS 'Mean F1-score for this species within this model, across validation epochs (optional).';


--
-- Name: COLUMN model_species.notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.model_species.notes IS 'Freeform notes describing this model-species relationship (e.g., training quality, issues, or remarks).';


--
-- Name: COLUMN model_species.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.model_species.created_at IS 'Timestamp when this model-species record was created.';


--
-- Name: COLUMN model_species.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.model_species.updated_at IS 'Timestamp when this model-species record was last updated.';


--
-- Name: model_species_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.model_species_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: model_species_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.model_species_id_seq OWNED BY public.model_species.id;


--
-- Name: observations_observation_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.observations_observation_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: observations_observation_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.observations_observation_id_seq OWNED BY public.observations.observation_id;


--
-- Name: observations_report; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.observations_report AS
 SELECT projects.name AS "Project Name",
    users.name AS "Processor Name",
    sessions.type AS "Session Type",
    observations.observation_id,
    observations."obsID",
    observations."PobsID",
    sessions.session_id AS "Session Number",
    observations."taxReview",
    observations.taxserial,
    observations.comname,
    observations.count,
    observations.coarsesize,
    observations.sex,
    observations.tc,
    observations.etc,
    sessions.dive,
    sessions.line,
    sessions."lineId",
    observations.note,
    observations."updatedAt",
    observations.video_source,
    observations."videoLocation",
    observations."mediaPosition",
    observations."actualPosition"
   FROM public.observations,
    public.projects,
    public.sessions,
    public.users
  WHERE ((sessions.user_id = users.user_id) AND (sessions.session_id = observations.session_id) AND (sessions.project_id = projects.project_id))
  ORDER BY sessions.session_id, observations."obsID";


--
-- Name: projects_project_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.projects_project_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: projects_project_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.projects_project_id_seq OWNED BY public.projects.project_id;


--
-- Name: sessions_session_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sessions_session_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sessions_session_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sessions_session_id_seq OWNED BY public.sessions.session_id;


--
-- Name: species; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.species (
    id integer NOT NULL,
    taxserial integer NOT NULL,
    gui_home_order character varying(255),
    gui_maintab character varying(255),
    gui_subtab character varying(255),
    gui_main_tab_order integer,
    gui_sub_tab_order integer,
    gui_item_order integer,
    gui_display_name character varying(255),
    comname character varying(255),
    species character varying(255),
    observation_type character varying(255),
    taxonomic_level character varying(255),
    report_group character varying(255),
    depth_min double precision,
    depth_max double precision,
    habitat_preference character varying(255),
    notes text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: TABLE species; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.species IS 'Taxonomic and GUI configuration table for species used in MARP observations, reports, and ML models.';


--
-- Name: COLUMN species.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.species.id IS 'Unique numeric identifier for this species record.';


--
-- Name: COLUMN species.taxserial; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.species.taxserial IS 'Internal MARP taxonomy serial number used as a unique ID across systems.';


--
-- Name: COLUMN species.gui_home_order; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.species.gui_home_order IS 'Ordering key used by MARP GUI to position this item on the home screen.';


--
-- Name: COLUMN species.gui_maintab; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.species.gui_maintab IS 'Main tab category where this item appears in the GUI (e.g., "Fish", "Invertebrates").';


--
-- Name: COLUMN species.gui_subtab; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.species.gui_subtab IS 'Sub-tab within the main tab where this item is displayed (e.g., "Sea Stars", "Crabs").';


--
-- Name: COLUMN species.gui_main_tab_order; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.species.gui_main_tab_order IS 'Order number for the main tab this item belongs to (controls tab sequencing).';


--
-- Name: COLUMN species.gui_sub_tab_order; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.species.gui_sub_tab_order IS 'Order number for the sub-tab this item belongs to (controls layout within a tab).';


--
-- Name: COLUMN species.gui_item_order; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.species.gui_item_order IS 'Position of this species within its GUI sub-tab group.';


--
-- Name: COLUMN species.gui_display_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.species.gui_display_name IS 'Display name for this item as shown in MARP GUI interfaces.';


--
-- Name: COLUMN species.comname; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.species.comname IS 'Common name used for this species (e.g., "Rockfish", "Sea Star").';


--
-- Name: COLUMN species.species; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.species.species IS 'Scientific or Latin name of the species (e.g., "Sebastes ruberrimus").';


--
-- Name: COLUMN species.observation_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.species.observation_type IS 'Category describing what type of organism this is (e.g., "Fish", "Invertebrate").';


--
-- Name: COLUMN species.taxonomic_level; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.species.taxonomic_level IS 'Taxonomic rank (e.g., "Species", "Genus", "Phylum", "Class").';


--
-- Name: COLUMN species.report_group; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.species.report_group IS 'Report grouping (e.g., "Sea Stars", "Corals - Gorgonians", "Anemones").';


--
-- Name: COLUMN species.depth_min; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.species.depth_min IS 'Minimum depth (in meters) where this species is typically observed.';


--
-- Name: COLUMN species.depth_max; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.species.depth_max IS 'Maximum depth (in meters) where this species is typically observed.';


--
-- Name: COLUMN species.habitat_preference; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.species.habitat_preference IS 'Habitat preference or substrate association (e.g., "Rocky", "Mud/Sand", "Mixed Hard/Soft").';


--
-- Name: COLUMN species.notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.species.notes IS 'Freeform notes about this species, its classification, or GUI behavior.';


--
-- Name: COLUMN species.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.species.created_at IS 'Timestamp when this species record was created.';


--
-- Name: COLUMN species.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.species.updated_at IS 'Timestamp when this species record was last updated.';


--
-- Name: species_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.species_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: species_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.species_id_seq OWNED BY public.species.id;


--
-- Name: subset_keyframes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subset_keyframes (
    keyframe_id integer,
    observation_id integer,
    subset character varying(255),
    comname character varying(255),
    type character varying(255),
    framenum integer,
    x double precision,
    y double precision,
    width double precision,
    height double precision,
    "createdAt" timestamp with time zone,
    "updatedAt" timestamp with time zone
);


--
-- Name: subset_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subset_observations (
    observation_id integer,
    project_id integer,
    session_id integer,
    user_id integer,
    tc character varying(255),
    frame character varying(255),
    taxserial integer,
    comname character varying(255),
    count integer,
    quadrant integer,
    etc character varying(255),
    note character varying(255),
    timelog character varying(255),
    video_source character varying(255),
    "videoLocation" character varying(255),
    "mediaPosition" character varying(255),
    "actualPosition" character varying(255),
    "createdAt" timestamp with time zone,
    "updatedAt" timestamp with time zone,
    sex character varying(255),
    coarsesize integer,
    "taxReview" character varying(255),
    downcamera character varying(255),
    sizereview integer,
    "obsID" integer,
    substrate_bedrock boolean,
    substrate_megaclast boolean,
    substrate_boulder boolean,
    substrate_cobble boolean,
    substrate_pebble boolean,
    substrate_granule boolean,
    substrate_sand boolean,
    substrate_mud boolean,
    substrate_coral_reef boolean,
    substrate_coral_rubble boolean,
    substrate_shell_hash boolean,
    substrate_shell_rubble boolean,
    substrate_algal boolean,
    "PobsID" integer
);


--
-- Name: subset_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subset_projects (
    project_id integer,
    name character varying(255),
    "createdAt" timestamp with time zone,
    "updatedAt" timestamp with time zone
);


--
-- Name: subset_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subset_sessions (
    session_id integer,
    project_id integer,
    user_id integer,
    dive character varying(255),
    line character varying(255),
    "lineId" character varying(255),
    type character varying(255),
    "createdAt" timestamp with time zone,
    "updatedAt" timestamp with time zone
);


--
-- Name: substrate60second_report; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.substrate60second_report AS
 SELECT projects.name AS "Project Name",
    users.name AS "Processor Name",
    sessions.type AS "Session Type",
    observations.observation_id,
    observations."obsID",
    observations."PobsID",
    sessions.session_id AS "Session Number",
    observations.tc,
    observations.comname AS "Substrate",
    observations.substrate_bedrock AS "Bedrock",
    observations.substrate_megaclast AS "Megaclast",
    observations.substrate_cobble AS "Cobble",
    observations.substrate_boulder AS "Boulder",
    observations.substrate_pebble AS "Pebble",
    observations.substrate_granule AS "Granule",
    observations.substrate_sand AS "Sand",
    observations.substrate_mud AS "Mud",
    observations.substrate_coral_reef AS "Coral Reef",
    observations.substrate_coral_rubble AS "Coral Rubble",
    observations.substrate_shell_hash AS "Shell Hash",
    observations.substrate_shell_rubble AS "Shell Rubble",
    observations.substrate_algal AS "Algal",
    sessions.dive,
    sessions.line,
    sessions."lineId",
    observations.note,
    observations."updatedAt",
    observations.video_source,
    observations."videoLocation",
    observations."mediaPosition",
    observations."actualPosition"
   FROM public.observations,
    public.projects,
    public.sessions,
    public.users
  WHERE ((sessions.user_id = users.user_id) AND (sessions.session_id = observations.session_id) AND (sessions.project_id = projects.project_id) AND ((sessions.type)::text = 'Substrate60Second'::text))
  ORDER BY sessions.session_id, observations."obsID";


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    description character varying(255),
    createdate timestamp with time zone,
    updateddate timestamp with time zone,
    createdby character varying(255) NOT NULL,
    updatedby character varying(255),
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


--
-- Name: tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tasks_id_seq OWNED BY public.tasks.id;


--
-- Name: training_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_runs (
    id integer NOT NULL,
    model_id integer NOT NULL,
    dataset_id integer,
    start_time timestamp with time zone,
    end_time timestamp with time zone,
    total_epochs integer,
    batch_size integer,
    learning_rate double precision,
    optimizer character varying(255),
    loss_function character varying(255),
    augmentation jsonb,
    compute_device character varying(255),
    train_script_commit character varying(255),
    notes text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: COLUMN training_runs.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_runs.id IS 'Unique identifier for this training run.';


--
-- Name: COLUMN training_runs.model_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_runs.model_id IS 'Foreign key referencing the parent ML model (ml_models.id).';


--
-- Name: COLUMN training_runs.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_runs.dataset_id IS 'Foreign key referencing the dataset used for training (datasets.id).';


--
-- Name: COLUMN training_runs.start_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_runs.start_time IS 'Timestamp when training began.';


--
-- Name: COLUMN training_runs.end_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_runs.end_time IS 'Timestamp when training completed.';


--
-- Name: COLUMN training_runs.total_epochs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_runs.total_epochs IS 'Total number of epochs configured for this run.';


--
-- Name: COLUMN training_runs.batch_size; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_runs.batch_size IS 'Training batch size used during this run.';


--
-- Name: COLUMN training_runs.learning_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_runs.learning_rate IS 'Base learning rate used during training.';


--
-- Name: COLUMN training_runs.optimizer; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_runs.optimizer IS 'Optimization algorithm (e.g., "Adam", "SGD").';


--
-- Name: COLUMN training_runs.loss_function; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_runs.loss_function IS 'Loss function used (e.g., "CrossEntropy", "FocalLoss").';


--
-- Name: COLUMN training_runs.augmentation; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_runs.augmentation IS 'JSON object containing data augmentation parameters and settings.';


--
-- Name: COLUMN training_runs.compute_device; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_runs.compute_device IS 'Hardware used for training (e.g., "RTX 6000 Ada", "A100 GPU").';


--
-- Name: COLUMN training_runs.train_script_commit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_runs.train_script_commit IS 'Git commit hash or version identifier of the training script used.';


--
-- Name: COLUMN training_runs.notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_runs.notes IS 'Freeform notes describing experiment purpose or results context.';


--
-- Name: COLUMN training_runs.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_runs.created_at IS 'Timestamp when this record was created.';


--
-- Name: COLUMN training_runs.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_runs.updated_at IS 'Timestamp when this record was last modified.';


--
-- Name: training_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.training_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: training_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.training_runs_id_seq OWNED BY public.training_runs.id;


--
-- Name: users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_user_id_seq OWNED BY public.users.user_id;


--
-- Name: artifacts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artifacts ALTER COLUMN id SET DEFAULT nextval('public.artifacts_id_seq'::regclass);


--
-- Name: dataset_observations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset_observations ALTER COLUMN id SET DEFAULT nextval('public.dataset_observations_id_seq'::regclass);


--
-- Name: datasets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.datasets ALTER COLUMN id SET DEFAULT nextval('public.datasets_id_seq'::regclass);


--
-- Name: epochs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.epochs ALTER COLUMN id SET DEFAULT nextval('public.epochs_id_seq'::regclass);


--
-- Name: hyperparameters id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hyperparameters ALTER COLUMN id SET DEFAULT nextval('public.hyperparameters_id_seq'::regclass);


--
-- Name: keyframes keyframe_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.keyframes ALTER COLUMN keyframe_id SET DEFAULT nextval('public.keyframes_keyframe_id_seq'::regclass);


--
-- Name: metaInfos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."metaInfos" ALTER COLUMN id SET DEFAULT nextval('public."metaInfos_id_seq"'::regclass);


--
-- Name: metrics_curves id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metrics_curves ALTER COLUMN id SET DEFAULT nextval('public.metrics_curves_id_seq'::regclass);


--
-- Name: metrics_summary id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metrics_summary ALTER COLUMN id SET DEFAULT nextval('public.metrics_summary_id_seq'::regclass);


--
-- Name: ml_models id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_models ALTER COLUMN id SET DEFAULT nextval('public.ml_models_id_seq'::regclass);


--
-- Name: model_species id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_species ALTER COLUMN id SET DEFAULT nextval('public.model_species_id_seq'::regclass);


--
-- Name: observations observation_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observations ALTER COLUMN observation_id SET DEFAULT nextval('public.observations_observation_id_seq'::regclass);


--
-- Name: projects project_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects ALTER COLUMN project_id SET DEFAULT nextval('public.projects_project_id_seq'::regclass);


--
-- Name: sessions session_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions ALTER COLUMN session_id SET DEFAULT nextval('public.sessions_session_id_seq'::regclass);


--
-- Name: species id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.species ALTER COLUMN id SET DEFAULT nextval('public.species_id_seq'::regclass);


--
-- Name: tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks ALTER COLUMN id SET DEFAULT nextval('public.tasks_id_seq'::regclass);


--
-- Name: training_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_runs ALTER COLUMN id SET DEFAULT nextval('public.training_runs_id_seq'::regclass);


--
-- Name: users user_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN user_id SET DEFAULT nextval('public.users_user_id_seq'::regclass);


--
-- Name: SequelizeMeta SequelizeMeta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SequelizeMeta"
    ADD CONSTRAINT "SequelizeMeta_pkey" PRIMARY KEY (name);


--
-- Name: artifacts artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artifacts
    ADD CONSTRAINT artifacts_pkey PRIMARY KEY (id);


--
-- Name: dataset_observations dataset_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset_observations
    ADD CONSTRAINT dataset_observations_pkey PRIMARY KEY (id);


--
-- Name: datasets datasets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.datasets
    ADD CONSTRAINT datasets_pkey PRIMARY KEY (id);


--
-- Name: epochs epochs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.epochs
    ADD CONSTRAINT epochs_pkey PRIMARY KEY (id);


--
-- Name: hyperparameters hyperparameters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hyperparameters
    ADD CONSTRAINT hyperparameters_pkey PRIMARY KEY (id);


--
-- Name: keyframes keyframes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.keyframes
    ADD CONSTRAINT keyframes_pkey PRIMARY KEY (keyframe_id);


--
-- Name: metaInfos metaInfos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."metaInfos"
    ADD CONSTRAINT "metaInfos_pkey" PRIMARY KEY (id);


--
-- Name: metrics_curves metrics_curves_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metrics_curves
    ADD CONSTRAINT metrics_curves_pkey PRIMARY KEY (id);


--
-- Name: metrics_summary metrics_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metrics_summary
    ADD CONSTRAINT metrics_summary_pkey PRIMARY KEY (id);


--
-- Name: ml_models ml_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_models
    ADD CONSTRAINT ml_models_pkey PRIMARY KEY (id);


--
-- Name: model_species model_species_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_species
    ADD CONSTRAINT model_species_pkey PRIMARY KEY (id);


--
-- Name: observations observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observations
    ADD CONSTRAINT observations_pkey PRIMARY KEY (observation_id);


--
-- Name: projects projects_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_name_key UNIQUE (name);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (project_id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (session_id);


--
-- Name: species species_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.species
    ADD CONSTRAINT species_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: training_runs training_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_runs
    ADD CONSTRAINT training_runs_pkey PRIMARY KEY (id);


--
-- Name: users users_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_name_key UNIQUE (name);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: artifacts_artifact_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artifacts_artifact_type_idx ON public.artifacts USING btree (artifact_type);


--
-- Name: artifacts_path_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artifacts_path_idx ON public.artifacts USING btree (path);


--
-- Name: artifacts_training_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artifacts_training_run_id_idx ON public.artifacts USING btree (training_run_id);


--
-- Name: dataset_observations_dataset_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dataset_observations_dataset_id_idx ON public.dataset_observations USING btree (dataset_id);


--
-- Name: dataset_observations_observation_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dataset_observations_observation_id_idx ON public.dataset_observations USING btree (observation_id);


--
-- Name: dataset_observations_unique_dataset_observation; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX dataset_observations_unique_dataset_observation ON public.dataset_observations USING btree (dataset_id, observation_id);


--
-- Name: datasets_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX datasets_name_idx ON public.datasets USING btree (name);


--
-- Name: datasets_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX datasets_source_idx ON public.datasets USING btree (source);


--
-- Name: epochs_epoch_number_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX epochs_epoch_number_idx ON public.epochs USING btree (epoch_number);


--
-- Name: epochs_start_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX epochs_start_time_idx ON public.epochs USING btree (start_time);


--
-- Name: epochs_training_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX epochs_training_run_id_idx ON public.epochs USING btree (training_run_id);


--
-- Name: hyperparameters_training_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hyperparameters_training_run_id_idx ON public.hyperparameters USING btree (training_run_id);


--
-- Name: meta_infos_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meta_infos_id ON public."metaInfos" USING btree (id);


--
-- Name: meta_infos_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meta_infos_name ON public."metaInfos" USING btree (name);


--
-- Name: metrics_curves_confidence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_curves_confidence_idx ON public.metrics_curves USING btree (confidence_threshold);


--
-- Name: metrics_curves_summary_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_curves_summary_id_idx ON public.metrics_curves USING btree (metrics_summary_id);


--
-- Name: metrics_summary_split_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_summary_split_idx ON public.metrics_summary USING btree (dataset_split);


--
-- Name: metrics_summary_training_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_summary_training_run_id_idx ON public.metrics_summary USING btree (training_run_id);


--
-- Name: ml_models_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_models_name_idx ON public.ml_models USING btree (name);


--
-- Name: model_species_model_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_species_model_id_idx ON public.model_species USING btree (model_id);


--
-- Name: model_species_species_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_species_species_id_idx ON public.model_species USING btree (species_id);


--
-- Name: model_species_unique_model_species; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX model_species_unique_model_species ON public.model_species USING btree (model_id, species_id);


--
-- Name: species_comname_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX species_comname_idx ON public.species USING btree (comname);


--
-- Name: species_gui_maintab_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX species_gui_maintab_idx ON public.species USING btree (gui_maintab);


--
-- Name: species_gui_subtab_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX species_gui_subtab_idx ON public.species USING btree (gui_subtab);


--
-- Name: species_report_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX species_report_group_idx ON public.species USING btree (report_group);


--
-- Name: species_taxserial_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX species_taxserial_idx ON public.species USING btree (taxserial);


--
-- Name: training_runs_dataset_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX training_runs_dataset_id_idx ON public.training_runs USING btree (dataset_id);


--
-- Name: training_runs_model_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX training_runs_model_id_idx ON public.training_runs USING btree (model_id);


--
-- Name: training_runs_start_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX training_runs_start_time_idx ON public.training_runs USING btree (start_time);


--
-- Name: artifacts artifacts_training_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artifacts
    ADD CONSTRAINT artifacts_training_run_id_fkey FOREIGN KEY (training_run_id) REFERENCES public.training_runs(id) ON DELETE CASCADE;


--
-- Name: dataset_observations dataset_observations_dataset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset_observations
    ADD CONSTRAINT dataset_observations_dataset_id_fkey FOREIGN KEY (dataset_id) REFERENCES public.datasets(id) ON DELETE CASCADE;


--
-- Name: epochs epochs_training_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.epochs
    ADD CONSTRAINT epochs_training_run_id_fkey FOREIGN KEY (training_run_id) REFERENCES public.training_runs(id) ON DELETE CASCADE;


--
-- Name: hyperparameters hyperparameters_training_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hyperparameters
    ADD CONSTRAINT hyperparameters_training_run_id_fkey FOREIGN KEY (training_run_id) REFERENCES public.training_runs(id) ON DELETE CASCADE;


--
-- Name: keyframes keyframes_observation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.keyframes
    ADD CONSTRAINT keyframes_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.observations(observation_id) ON DELETE CASCADE;


--
-- Name: metrics_curves metrics_curves_metrics_summary_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metrics_curves
    ADD CONSTRAINT metrics_curves_metrics_summary_id_fkey FOREIGN KEY (metrics_summary_id) REFERENCES public.metrics_summary(id) ON DELETE CASCADE;


--
-- Name: metrics_curves metrics_curves_species_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metrics_curves
    ADD CONSTRAINT metrics_curves_species_id_fkey FOREIGN KEY (species_id) REFERENCES public.species(id);


--
-- Name: metrics_summary metrics_summary_species_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metrics_summary
    ADD CONSTRAINT metrics_summary_species_id_fkey FOREIGN KEY (species_id) REFERENCES public.species(id);


--
-- Name: metrics_summary metrics_summary_training_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metrics_summary
    ADD CONSTRAINT metrics_summary_training_run_id_fkey FOREIGN KEY (training_run_id) REFERENCES public.training_runs(id) ON DELETE CASCADE;


--
-- Name: ml_models ml_models_parent_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_models
    ADD CONSTRAINT ml_models_parent_model_id_fkey FOREIGN KEY (parent_model_id) REFERENCES public.ml_models(id) ON DELETE SET NULL;


--
-- Name: model_species model_species_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_species
    ADD CONSTRAINT model_species_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.ml_models(id) ON DELETE CASCADE;


--
-- Name: model_species model_species_species_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_species
    ADD CONSTRAINT model_species_species_id_fkey FOREIGN KEY (species_id) REFERENCES public.species(id);


--
-- Name: observations observations_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observations
    ADD CONSTRAINT observations_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(project_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: observations observations_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observations
    ADD CONSTRAINT observations_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(session_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: observations observations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observations
    ADD CONSTRAINT observations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sessions sessions_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(project_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: training_runs training_runs_dataset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_runs
    ADD CONSTRAINT training_runs_dataset_id_fkey FOREIGN KEY (dataset_id) REFERENCES public.datasets(id);


--
-- Name: training_runs training_runs_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_runs
    ADD CONSTRAINT training_runs_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.ml_models(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


