<?php

return [
    'created' => 'Contract created successfully.',
    'updated' => 'Contract updated successfully.',
    'cancelled' => 'Contract cancelled successfully.',
    'reservation_not_found_or_not_active' => 'Reservation not found or not active.',
    'reservation_has_no_unit' => 'Reservation has no unit assigned yet.',
    'unit_not_found' => 'Unit not found.',
    'unit_not_in_reservation_building' => 'Unit is not in the reservation building.',
    'down_payment_less_than_reservation_payments' => 'Agreed down payment must be >= reservation payments.',
    'down_payment_exceeds_price' => 'Agreed down payment cannot exceed price.',
    'start_date_required_for_installments' => 'Start date required when installments > 0.',
    'interval_required_for_installments' => 'Interval required when installments > 0.',
    'max_installments_exceeded' => 'Maximum installments count exceeded (360).',
    'unit_has_active_reservation' => 'Unit has an active reservation. Convert it instead.',
    'cannot_cancel_non_active' => 'Cannot cancel a non-active contract.',
    'cannot_edit_price_below_deposit' => 'Cannot edit price below total deposits paid.',
    'price_required_for_sale' => 'A sale contract needs a price (or a schedule with amounts).',
    'rent_total_required' => 'A rent contract needs a total, a schedule, or a monthly rent and term.',
    'not_a_draft' => 'This contract is not a draft, it cannot be posted again.',
];