<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Policies\AuditLogPolicy;
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

        $logs = $query->orderBy('occurred_at', 'desc')
            ->with('user')
            ->paginate();

        return response()->json([
            'data' => $logs,
        ]);
    }

    public function show(AuditLog $auditLog): JsonResponse
    {
        $this->authorize('view', $auditLog);

        return response()->json([
            'data' => $auditLog->load('user'),
        ]);
    }
}
