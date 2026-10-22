<?php
/**
 * Plugin Name: KOBA-I Disposable Ebook Idempotency Harness
 * Description: Localhost-only WordPress fixtures for isolated Save & Sync acceptance.
 * Version: 0.0.1
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

const KOBA_EBOOK_TEST_TOKEN = 'koba-ebook-disposable-only-2026';

add_filter( 'wp_is_application_passwords_available', '__return_true' );

function koba_ebook_test_activate() {
    update_option( 'koba_license_status', 'active' );
    update_option( 'koba_license_key', 'KOBA-AUDIO-DISPOSABLE' );
    update_option( 'koba_license_associated_website', home_url( '/' ) );
    $login = 'koba_ebook_gateway';
    $user = get_user_by( 'login', $login );
    $user_id = $user ? (int) $user->ID : wp_create_user( $login, wp_generate_password( 32 ), $login . '@example.invalid' );
    if ( is_wp_error( $user_id ) ) {
        throw new RuntimeException( $user_id->get_error_message() );
    }
    ( new WP_User( $user_id ) )->set_role( 'administrator' );
    $created = WP_Application_Passwords::create_new_application_password(
        $user_id,
        array( 'name' => 'KOBA-I disposable ebook idempotency test' )
    );
    if ( is_wp_error( $created ) ) {
        throw new RuntimeException( $created->get_error_message() );
    }
    $upload_dir = wp_upload_dir();
    wp_mkdir_p( $upload_dir['basedir'] );
    file_put_contents(
        trailingslashit( $upload_dir['basedir'] ) . 'koba-ebook-test-credentials.json',
        wp_json_encode(
            array(
                'siteUrl' => home_url( '/' ),
                'gateway' => array( 'username' => $login, 'password' => $created[0] ),
                'controlToken' => KOBA_EBOOK_TEST_TOKEN,
            )
        )
    );
}
register_activation_hook( __FILE__, 'koba_ebook_test_activate' );

add_action(
    'rest_api_init',
    function () {
        register_rest_route(
            'koba-ebook-test/v1',
            '/state',
            array(
                'methods' => 'GET',
                'permission_callback' => function ( $request ) {
                    return hash_equals( KOBA_EBOOK_TEST_TOKEN, (string) $request->get_header( 'X-Koba-Test-Token' ) );
                },
                'callback' => function () {
                    $posts = get_posts(
                        array(
                            'post_type' => array( 'koba_publication', 'page' ),
                            'post_status' => 'any',
                            'numberposts' => -1,
                            'orderby' => 'ID',
                            'order' => 'ASC',
                        )
                    );
                    return array_map(
                        function ( $post ) {
                            return array(
                                'id' => (int) $post->ID,
                                'type' => $post->post_type,
                                'status' => $post->post_status,
                                'title' => (string) $post->post_title,
                                'slug' => (string) $post->post_name,
                                'assetKey' => (string) get_post_meta( $post->ID, 'koba_asset_key', true ) ?: (string) get_post_meta( $post->ID, 'assetKey', true ),
                            );
                        },
                        $posts
                    );
                },
            )
        );
    }
);
