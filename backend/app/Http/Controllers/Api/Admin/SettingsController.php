<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Settings\UpdateSettingsRequest;
use App\Services\Settings\SettingsService;
use Illuminate\Http\JsonResponse;

class SettingsController extends Controller
{
    public function __construct(private SettingsService $settingsService) {}

    public function show(): JsonResponse
    {
        $this->authorize('settings.view');

        return response()->json([
            'data' => $this->settingsService->all(),
        ]);
    }

    public function update(UpdateSettingsRequest $request): JsonResponse
    {
        $this->authorize('settings.update');

        return response()->json([
            'data' => $this->settingsService->update($request->validated(), $request->user()),
        ]);
    }
}
