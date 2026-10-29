<?php

return [
    'user_status' => [
        'active' => 'Active',
        'suspended' => 'Suspended',
    ],
    'building_type' => [
        'building' => 'Building',
        'tower' => 'Tower',
        'house' => 'House',
        'office_building' => 'Office Building',
    ],
    'building_activity' => [
        'residential' => 'Residential',
        'administrative' => 'Administrative',
        'commercial' => 'Commercial',
        'medical' => 'Medical',
        'hotel' => 'Hotel',
    ],
    'unit_type' => [
        'apartment' => 'Apartment',
        'shop' => 'Shop',
        'warehouse' => 'Warehouse',
        'studio' => 'Studio',
    ],
    'unit_status' => [
        'available' => 'Available',
        'reserved' => 'Reserved',
        'sold' => 'Sold',
        'rented' => 'Rented',
    ],
    'unit_purpose' => [
        'sale' => 'Sale',
        'rent' => 'Rent',
        'both' => 'Sale and rent',
    ],
    'reservation_status' => [
        'active' => 'Active',
        'converted' => 'Converted',
        'cancelled' => 'Cancelled',
    ],
    'payment_status' => [
        'valid' => 'Valid',
        'cancelled' => 'Cancelled',
    ],
    'payment_method' => [
        'cash' => 'Cash',
        'bank_transfer' => 'Bank Transfer',
        'cheque' => 'Cheque',
        'vodafone_cash' => 'Vodafone Cash',
        'instapay' => 'InstaPay',
        'other' => 'Other',
    ],
    'contract_type' => [
        'sale' => 'Sale',
        'rent' => 'Rent',
    ],
    'contract_status' => [
        'draft' => 'Draft',
        'active' => 'Active',
        'cancelled' => 'Cancelled',
    ],
    'installment_status' => [
        'due' => 'Due',
        'partially_paid' => 'Partially Paid',
        'paid' => 'Paid',
        'cancelled' => 'Cancelled',
    ],
    // Display state on the collection page, recomputed against today (overdue overrides partial).
    'collection_status' => [
        'due' => 'Due',
        'overdue' => 'Overdue',
        'partially_paid' => 'Partial',
        'paid' => 'Paid',
    ],
];
