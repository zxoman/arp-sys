<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    |
    | The front-end prototype (`front/`) talks to this API from a different
    | origin (the Vite dev server). Bearer-token auth is used, so credentials
    | are not required; requests are allowed from any origin in development.
    |
    */

    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    'allowed_origins' => ['*'],

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    // Browsers cache the preflight result for this many seconds (Chrome caps at 2h).
    // Every preflight is a full framework boot, so caching it halves a page's request cost.
    'max_age' => 7200,

    'supports_credentials' => false,

];
