<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Roles\StoreRoleRequest;
use App\Http\Requests\Roles\UpdateRoleRequest;
use App\Http\Resources\Auth\RoleResource;
use App\Models\Role;
use App\Policies\RolePolicy;
use App\Services\Roles\RoleService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RolesController extends Controller
{
    public function __construct(private RoleService $roleService) {}

    public function index(): JsonResponse
    {
        $this->authorize('viewAny', Role::class);

        $roles = Role::orderBy('created_at', 'desc')->paginate();

        return response()->json([
            'data' => RoleResource::collection($roles),
        ]);
    }

    public function store(StoreRoleRequest $request): JsonResponse
    {
        $role = $this->roleService->create($request->validated(), $request->user());

        return response()->json([
            'data' => new RoleResource($role),
        ], 201);
    }

    public function show(Role $role): JsonResponse
    {
        $this->authorize('view', $role);

        return response()->json([
            'data' => new RoleResource($role),
        ]);
    }

    public function update(UpdateRoleRequest $request, Role $role): JsonResponse
    {
        $this->authorize('update', $role);

        $role = $this->roleService->update(
            $role,
            $request->validated(),
            $request->user(),
            $request->validated('lock_version'),
        );

        return response()->json([
            'data' => new RoleResource($role),
        ]);
    }

    public function destroy(Role $role, Request $request): JsonResponse
    {
        $this->authorize('delete', $role);

        $this->roleService->delete($role, $request->user());

        return response()->json([
            'data' => ['message' => __('auth.role_deleted')],
        ]);
    }

    public function permissions(Request $request): JsonResponse
    {
        $this->authorize('viewAny', Role::class);

        return response()->json([
            'data' => array_map(fn ($p) => [
                'value' => $p->value,
                'label' => $p->label(),
                'entity' => $p->entity(),
                'action' => $p->action(),
            ], \App\Enums\Permission::cases()),
        ]);
    }
}
