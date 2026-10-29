<?php

return [
    'created' => 'Unit created successfully.',
    'updated' => 'Unit updated successfully.',
    'deleted' => 'Unit deleted successfully.',
    'floor_not_in_building' => 'The selected floor does not belong to this building.',
    'activity_required' => 'Activity is required when building has multiple activities.',
    'activity_not_in_building' => 'The selected activity is not one of the building\'s activities.',
    'area_must_be_positive' => 'Area must be greater than zero.',
    'cannot_edit_sold_unit' => 'Cannot edit area or price per meter when unit is sold.',
    'cannot_edit_locked_unit' => 'Cannot edit purpose, sale price or availability after the unit is sold or rented.',
    'sale_price_not_allowed_for_rent' => 'A rent-only unit cannot have a sale price.',
    'non_sellable_reason_required' => 'A reason is required when the unit is not available for sale or rent.',
    'not_available' => 'The unit is not available for sale or rent.',
    'purpose_sale_only' => 'The unit is offered for sale only.',
    'purpose_rent_only' => 'The unit is offered for rent only.',
    'building_id_immutable' => 'Building ID is immutable after creation.',
    'cannot_delete_with_reservation_or_contract' => 'Cannot delete unit with active reservation or non-cancelled contract.',
];
