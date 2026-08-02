import apiFetch from '@wordpress/api-fetch';
import { InspectorControls, useBlockProps } from '@wordpress/block-editor';
import {
    Button,
    Flex,
    FlexItem,
    Notice,
    PanelBody,
    SearchControl,
    Spinner,
} from '@wordpress/components';
import { useDebounce } from '@wordpress/compose';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import { decodeEntities } from '@wordpress/html-entities';
import { __, sprintf } from '@wordpress/i18n';
import { addQueryArgs } from '@wordpress/url';

const PER_PAGE = 10;
const POST_FIELDS = 'id,title,link';

/**
 * Fetches a page of published posts, plus (when the search term is numeric)
 * the post with that exact ID, merged to the top of the first page.
 */
async function fetchPosts(search, page) {
    const response = await apiFetch({
        path: addQueryArgs('/wp/v2/posts', {
            search: search || undefined,
            page,
            per_page: PER_PAGE,
            status: 'publish',
            orderby: search ? 'relevance' : 'date',
            _fields: POST_FIELDS,
        }),
        parse: false,
    });

    const results = await response.json();
    const totalPages =
        parseInt(response.headers.get('X-WP-TotalPages'), 10) || 0;

    let idMatch = [];
    if (page === 1 && /^\d+$/.test(search)) {
        try {
            const post = await apiFetch({
                path: addQueryArgs(`/wp/v2/posts/${search}`, {
                    _fields: POST_FIELDS,
                }),
            });
            idMatch = [post];
        } catch {
            // No published post with that ID — text results still apply.
        }
    }

    return {
        posts: [
            ...idMatch,
            ...results.filter(
                post => !idMatch.some(match => match.id === post.id)
            ),
        ],
        totalPages,
    };
}

export default function Edit({ attributes, setAttributes }) {
    const { postId, postTitle, postUrl } = attributes;

    const [searchInput, setSearchInput] = useState('');
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(1);
    const [posts, setPosts] = useState([]);
    const [totalPages, setTotalPages] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    // Monotonic counter so late responses from superseded requests are ignored.
    const fetchIdRef = useRef(0);

    // The callback must be referentially stable: useDebounce re-creates the
    // debounced function (and cancels its pending timer) whenever the callback
    // identity changes, so an inline arrow here would cancel itself on every
    // re-render and setQuery would never fire.
    const setQueryAndResetPage = useCallback(value => {
        setQuery(value);
        setPage(1);
    }, []);
    const debouncedSetQuery = useDebounce(setQueryAndResetPage, 300);

    const onSearchChange = value => {
        setSearchInput(value);
        debouncedSetQuery(value.trim());
    };

    useEffect(() => {
        const fetchId = ++fetchIdRef.current;
        const isStale = () => fetchId !== fetchIdRef.current;

        setIsLoading(true);
        setError(null);

        fetchPosts(query, page)
            .then(result => {
                if (isStale()) {
                    return;
                }
                setPosts(result.posts);
                setTotalPages(result.totalPages);
                setIsLoading(false);
            })
            .catch(fetchError => {
                if (isStale()) {
                    return;
                }
                setPosts([]);
                setTotalPages(0);
                setError(
                    fetchError?.message ||
                        __('Unable to load posts.', 'dmg-read-more')
                );
                setIsLoading(false);
            });
    }, [query, page]);

    const selectPost = post => {
        setAttributes({
            postId: post.id,
            postTitle:
                decodeEntities(post.title?.rendered || '').trim() ||
                __('(no title)', 'dmg-read-more'),
            postUrl: post.link,
        });
    };

    const blockProps = useBlockProps({ className: 'dmg-read-more' });

    return (
        <>
            <InspectorControls>
                <PanelBody
                    title={__('Read More link', 'dmg-read-more')}
                    initialOpen
                >
                    <SearchControl
                        label={__('Search posts', 'dmg-read-more')}
                        help={__(
                            'Search by keyword or enter a post ID. Recent posts are shown by default.',
                            'dmg-read-more'
                        )}
                        value={searchInput}
                        onChange={onSearchChange}
                        __nextHasNoMarginBottom
                    />

                    {error && (
                        <Notice status="error" isDismissible={false}>
                            {error}
                        </Notice>
                    )}

                    {isLoading && (
                        <Flex justify="center">
                            <Spinner />
                        </Flex>
                    )}

                    {!isLoading && !error && posts.length === 0 && (
                        <p>{__('No posts found.', 'dmg-read-more')}</p>
                    )}

                    {!isLoading && posts.length > 0 && (
                        <ul
                            className="dmg-read-more__results"
                            aria-label={__(
                                'Post search results',
                                'dmg-read-more'
                            )}
                        >
                            {posts.map(post => (
                                <li key={post.id}>
                                    <Button
                                        variant={
                                            post.id === postId
                                                ? 'primary'
                                                : 'secondary'
                                        }
                                        onClick={() => selectPost(post)}
                                        aria-pressed={post.id === postId}
                                    >
                                        {decodeEntities(
                                            post.title?.rendered || ''
                                        ) || __('(no title)', 'dmg-read-more')}
                                        <span className="dmg-read-more__result-id">
                                            {sprintf(
                                                /* translators: %d: post ID. */
                                                __('ID: %d', 'dmg-read-more'),
                                                post.id
                                            )}
                                        </span>
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}

                    {totalPages > 1 && (
                        <Flex
                            className="dmg-read-more__pagination"
                            justify="space-between"
                        >
                            <FlexItem>
                                <Button
                                    variant="tertiary"
                                    disabled={isLoading || page <= 1}
                                    onClick={() => setPage(page - 1)}
                                >
                                    {__('Previous', 'dmg-read-more')}
                                </Button>
                            </FlexItem>
                            <FlexItem>
                                {sprintf(
                                    /* translators: 1: current page, 2: total pages. */
                                    __('Page %1$d of %2$d', 'dmg-read-more'),
                                    page,
                                    totalPages
                                )}
                            </FlexItem>
                            <FlexItem>
                                <Button
                                    variant="tertiary"
                                    disabled={isLoading || page >= totalPages}
                                    onClick={() => setPage(page + 1)}
                                >
                                    {__('Next', 'dmg-read-more')}
                                </Button>
                            </FlexItem>
                        </Flex>
                    )}
                </PanelBody>
            </InspectorControls>

            <p {...blockProps}>
                {postId ? (
                    <>
                        {__('Read More: ', 'dmg-read-more')}
                        <a
                            href={postUrl}
                            onClick={event => event.preventDefault()}
                        >
                            {postTitle}
                        </a>
                    </>
                ) : (
                    <em>
                        {__(
                            'Read More: choose a post in the block settings sidebar.',
                            'dmg-read-more'
                        )}
                    </em>
                )}
            </p>
        </>
    );
}
