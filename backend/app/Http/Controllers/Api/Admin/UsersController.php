<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Users\StoreUserRequest;
use App\Http\Requests\Users\UpdateUserRequest;
use App\Http\Resources\Auth\UserResource;
use App\Models\User;
use App\Policies\UserPolicy;
use App\Services\Users\UserService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class UsersController extends Controller
{
    public function __construct(private UserService $userService) {}

    public function index(): JsonResponse
    {
        $this->authorize('viewAny', User::class);

        $users = User::with('role')->orderBy('created_at', 'desc')->paginate();

        return response()->json([
            'data' => UserResource::collection($users),
        ]);
    }

    public function store(StoreUserRequest $request): JsonResponse
    {
        $user = $this->userService->create($request->validated(), $request->user());

        return response()->json([
            'data' => new UserResource($user),
        ], 201);
    }

    public function show(User $user): JsonResponse
    {
        $this->authorize('view', $user);

        return response()->json([
            'data' => new UserResource($user->load('role')),
        ]);
    }

    public function update(UpdateUserRequest $request, User $user): JsonResponse
    {
        $this->authorize('update', $user);

        $user = $this->userService->update(
            $user,
            $request->validated(),
            $request->user(),
            $request->validated('lock_version'),
        );

        return response()->json([
            'data' => new UserResource($user->load('role')),
        ]);
    }

    public function destroy(User $user, Request $request): JsonResponse
    {
        $this->authorize('delete', $user);

        $this->userService->delete($user, $request->user());

        return response()->json([
            'data' => ['message' => __('auth.user_deleted')],
        ]);
    }

    public function suspend(User $user, Request $request): JsonResponse
    {
        $this->authorize('update', $user);

        $this->userService->suspend($user, $request->user());

        return response()->json([
            'data' => ['message' => __('auth.user_suspended')],
        ]);
    }

    public function activate(User $user, Request $request): JsonResponse
    {
        $this->authorize('update', $user);

        $this->userService->activate($user, $request->user());

        return response()->json([
            'data' => ['message' => __('auth.user_activated')],
        ]);
    }

    public function resetPassword(User $user, Request $request): JsonResponse
    {
        $this->authorize('update', $user);

        $validated = $request->validate([
            'new_password' => ['required', 'string', 'min:8'],
        ]);

        $this->userService->resetPassword($user, $validated['new_password'], $request->user());

        return response()->json([
            'data' => ['message' => __('auth.password_reset')],
        ]);
    }
}
