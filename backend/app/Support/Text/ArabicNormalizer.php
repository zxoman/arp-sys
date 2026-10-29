<?php

namespace App\Support\Text;

class ArabicNormalizer
{
    public static function normalize(string $text): string
    {
        if ($text === '') {
            return '';
        }

        $text = self::toArabicIndicReverse($text);

        // Trim and collapse whitespace
        $text = preg_replace('/\s+/u', ' ', trim($text));

        // Normalize hamza variants: أ إ آ -> ا, ئ ئ -> ي, ة -> ه, ى -> ي
        $replacements = [
            'أ' => 'ا',
            'إ' => 'ا',
            'آ' => 'ا',
            'ئ' => 'ي',
            'ؤ' => 'و',
            'ة' => 'ه',
            'ى' => 'ي',
        ];

        $text = str_replace(array_keys($replacements), array_values($replacements), $text);

        // Remove diacritics (tashkeel)
        $text = preg_replace('/[\x{064B}-\x{065F}]/u', '', $text);

        return $text;
    }

    public static function matches(string $a, string $b): bool
    {
        return self::normalize($a) === self::normalize($b);
    }

    private static function toArabicIndicReverse(string $text): string
    {
        $arabicIndic = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
        $ascii = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

        return str_replace($arabicIndic, $ascii, $text);
    }
}
