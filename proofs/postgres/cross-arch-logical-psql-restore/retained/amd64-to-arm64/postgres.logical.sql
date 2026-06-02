--
-- PostgreSQL database dump
--

\restrict vwzT3X8yOXTkQEReNmFWVF2M9UfsNQUgjrRQdMDBFT3e7dhqEDWj2kmRGJ3nhXB

-- Dumped from database version 15.18 (Debian 15.18-1.pgdg12+1)
-- Dumped by pg_dump version 15.18 (Debian 15.18-1.pgdg12+1)

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

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id integer NOT NULL,
    payload text NOT NULL,
    value integer NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.events_id_seq OWNED BY public.events.id;


--
-- Name: events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events ALTER COLUMN id SET DEFAULT nextval('public.events_id_seq'::regclass);


--
-- Data for Name: events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.events (id, payload, value, updated_at) FROM stdin;
1	alpha	10	2026-06-02 18:29:41.903742+00
3	gamma	30	2026-06-02 18:29:41.903742+00
2	beta	25	2026-06-02 18:29:41.903742+00
4	delta	40	2026-06-02 18:29:42.104876+00
\.


--
-- Name: events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.events_id_seq', 4, true);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- PostgreSQL database dump complete
--

\unrestrict vwzT3X8yOXTkQEReNmFWVF2M9UfsNQUgjrRQdMDBFT3e7dhqEDWj2kmRGJ3nhXB

