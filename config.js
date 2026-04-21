// ================================================================
// FITNESS PARK ROMANIA — CONFIG (Global)
// ================================================================
// Global constants: API endpoints, Google Maps Platform, model version.
// This file is loaded BEFORE all data and logic modules.
//
// NOTE on GOOGLE_API_KEY: this key is domain-restricted at the
// Google Cloud Console (only *.isseo-dev.com allowed). Safe to commit,
// but rotate if ever abused. To rotate: change below + redeploy.
// ================================================================

// Bucharest reference coordinates
const BUCHAREST = [44.4268, 26.1025];

// OpenStreetMap endpoints (free, no key needed)
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const NOMINATIM = 'https://nominatim.openstreetmap.org';

// Google Maps Platform
const GOOGLE_API_KEY = 'AIzaSyDPj1aNT8HICzvPOXHSyQtl1oKf3vSu3so';
const GOOGLE_PLACES_URL = 'https://places.googleapis.com/v1/places';
const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const _googleHasKey = () => GOOGLE_API_KEY && GOOGLE_API_KEY !== 'YOUR_GOOGLE_API_KEY';
const _googleCache = {}; // in-memory cache for session
const GOOGLE_CACHE_KEY = 'fp_google_cache';
const GOOGLE_CACHE_TTL = 7 * 24 * 3600 * 1000; // 7 days

// Model version — bumped when cached data format changes; triggers cache clear
const MODEL_VERSION = 'v6.54-onboarding-churn-cohort-y1-y2-y3';
