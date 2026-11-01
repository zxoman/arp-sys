<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\Admin\AuditLogResource;
use App\Models\AuditLog;
use Illuminate\Http\JsonResponse;

class AuditLogsController extends Controller
{
    public function index(): JsonResponse
    {
        $this->authorize('viewAny', AuditLog::class);

        $query = AuditLog::query();

        if ($userId = request('user_id')) {
            $query->where('user_id', $userId);
        }

        if ($action = request('action')) {
            $query->where('action', $action);
        }

        if ($entityType = request('entity_type')) {
            $query->where('entity_type', $entityType);
        }

        if ($from = request('from')) {
            $query->where('occurred_at', '>=', $from);
        }

        if ($to = request('to')) {
            $query->where('occurred_at', '<=', $to);
        }

        if ($search = trim((string) request('search'))) {
            $like = "%{$search}%";
            $query->where(function ($q) use ($like) {
                $q->where('reason', 'like', $like)
                    ->orWhere('entity_type', 'like', $like)
                    ->orWhere('endpoint', 'like', $like);
            });
        }

        $perPage = max(1, min((int) request('per_page', 20), 100));
        $logs = $query->orderBy('occurred_at', 'desc')
            ->with('user')
            ->paginate($perPage)
            ->withQueryString();

        return response()->json([
            'data' => AuditLogResource::collection($logs),
            'meta' => [
                'current_page' => $logs->currentPage(),
                'last_page' => $logs->lastPage(),
                'per_page' => $logs->perPage(),
                'total' => $logs->total(),
                'from' => $logs->firstItem(),
                'to' => $logs->lastItem(),
            ],
        ]);
    }

    public function show(AuditLog $auditLog): JsonResponse
    {
        $this->authorize('view', $auditLog);

        return response()->json([
            'data' => new AuditLogResource($auditLog->load('user')),
        ]);
    }
}
