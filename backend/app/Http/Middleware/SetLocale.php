<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class SetLocale
{
    public function handle(Request $request, Closure $next)
    {
        $locale = $request->header('Accept-Language', 'ar');
        // Take the first locale code (e.g. "ar" from "ar-EG,en;q=0.9")
        $locale = explode(',', $locale)[0];
        $locale = explode('-', $locale)[0];

        $supported = ['ar', 'en'];
        app()->setLocale(in_array($locale, $supported) ? $locale : 'ar');

        return $next($request);
    }
}
