<?php

namespace App\SystemTest\Journeys;

use App\SystemTest\Journey;
use App\SystemTest\JourneyResult;

/** Sign-in, profile, password rules, logout and the permission gate. */
class AuthJourney extends Journey
{
    public function __construct()
    {
        parent::__construct('Auth');
    }

    public function run(): JourneyResult
    {
        $this->assert($this->get('/api/v1/auth/me')['status'], 401, 'anonymous /auth/me is refused');

        $wrong = $this->post('/api/v1/auth/login', ['login' => 'admin', 'password' => 'definitely-wrong']);
        $this->assert($wrong['status'], 422, 'wrong password is refused with 422');

        if (! $this->login()) {
            return $this->result;
        }

        $this->expect($this->get('/api/v1/auth/me'), 200, 'view own profile', 'data.username', 'admin');

        $profile = $this->put('/api/v1/auth/profile', ['name' => 'Admin User']);
        $this->expect($profile, 200, 'update own profile');

        // A weak new password is rejected before it can lock anyone out.
        $weak = $this->post('/api/v1/auth/password', [
            'current_password' => 'password123',
            'password' => '123',
            'password_confirmation' => '123',
        ]);
        $this->assert($weak['status'] === 422 || $weak['status'] === 400, true, 'weak password is refused');

        // Unauthenticated access to a protected admin route.
        $saved = $this->token;
        $this->token = null;
        $this->expect($this->get('/api/v1/admin/buildings'), 401, 'admin routes need a token');
        $this->token = $saved;

        $this->expect($this->post('/api/v1/auth/logout'), 200, 'logout');

        // The token is revoked server-side (single-session), so it no longer works.
        $this->expect($this->get('/api/v1/auth/me'), 401, 'token is dead after logout');

        return $this->result;
    }
}
