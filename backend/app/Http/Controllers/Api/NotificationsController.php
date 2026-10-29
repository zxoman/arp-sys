<?php

namespace App\Http\Controllers\Api;

use App\Enums\ContractStatus;
use App\Http\Controllers\Controller;
use App\Http\Resources\Collections\NotificationItemResource;
use App\Models\Installment;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;

/**
 * The header bell: installments and rent payments of active contracts that are overdue or fall due
 * today. Items are read-only links to the collection page; each group carries its full count while
 * the payload is capped so the popover stays small.
 */
class NotificationsController extends Controller
{
    private const ITEMS_PER_GROUP = 10;

    public function index(): JsonResponse
    {
        $this->authorize('contracts.view');
        $today = Carbon::today();

        $open = Installment::query()
            ->where('installments.remaining', '>', 0)
            ->whereHas('contract', fn (Builder $q) => $q->where('status', ContractStatus::ACTIVE->value))
            ->with('contract.client', 'contract.unit.building');

        $overdue = (clone $open)
            ->whereDate('installments.due_date', '<', $today->toDateString())
            ->orderBy('installments.due_date')
            ->orderBy('installments.id');
        $dueToday = (clone $open)
            ->whereDate('installments.due_date', '=', $today->toDateString())
            ->orderBy('installments.id');

        $overdueCount = (clone $overdue)->count();
        $dueTodayCount = (clone $dueToday)->count();

        $groups = [
            [
                'id' => 'overdue',
                'label' => __('notifications.overdue'),
                'tone' => 'danger',
                'screen' => 'installments',
                'total' => $overdueCount,
                'items' => NotificationItemResource::collection($overdue->limit(self::ITEMS_PER_GROUP)->get()),
            ],
            [
                'id' => 'due-today',
                'label' => __('notifications.due_today'),
                'tone' => 'warning',
                'screen' => 'installments',
                'total' => $dueTodayCount,
                'items' => NotificationItemResource::collection($dueToday->limit(self::ITEMS_PER_GROUP)->get()),
            ],
        ];

        return response()->json([
            'data' => $groups,
            'meta' => [
                'total' => $overdueCount + $dueTodayCount,
                'today' => $today->toDateString(),
            ],
        ]);
    }
}
