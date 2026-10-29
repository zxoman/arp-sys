<?php

namespace App\Http\Controllers\Api\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Auth\LogoutRequest;
use App\Http\Resources\Auth\UserResource;
use App\Services\Auth\LoginService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AuthController extends Controller
{
    public function __construct(private LoginService $loginService) {}

    public function login(LoginRequest $request): JsonResponse
    {
        $result = $this->loginService->login(
            login: $request->validated('login'),
            password: $request->validated('password'),
            ip: $request->ip(),
            userAgent: $request->userAgent(),
        );

        return response()->json([
            'data' => [
                'token' => $result['token'],
                'user' => new UserResource($result['user']),
            ],
        ]);
    }

    public function logout(LogoutRequest $request): JsonResponse
    {
        $this->loginService->logout($request->user());

        return response()->json([
            'data' => ['message' => __('auth.logged_out')],
        ]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json([
            'data' => new UserResource($request->user()),
        ]);
    }

    public function updateProfile(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:50'],
        ]);

        $user = $request->user();
        $user->fill(array_filter($validated));
        $user->save();

        return response()->json([
            'data' => new UserResource($user),
        ]);
    }

    public function changePassword(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'old_password' => ['required', 'string'],
            'new_password' => ['required', 'string', 'min:8'],
        ]);

        $user = $request->user();

        if (!password_verify($validated['old_password'], $user->password)) {
            return response()->json([
                'message' => __('auth.invalid_old_password'),
            ], 422);
        }

        $user->password = bcrypt($validated['new_password']);
        $user->lock_version = $user->lock_version + 1;
        $user->save();

        // Revoke other sessions (keep current)
        $currentTokenId = $request->user()->currentAccessToken()->id;
        $user->tokens()->where('id', '!=', $currentTokenId)->delete();

        return response()->json([
            'data' => ['message' => __('auth.password_changed')],
        ]);
    }
}
