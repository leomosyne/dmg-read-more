import { useBlockProps } from '@wordpress/block-editor';

export default function save({ attributes }) {
    const { postId, postTitle, postUrl } = attributes;

    if (!postId || !postUrl) {
        return null;
    }

    return (
        <p {...useBlockProps.save({ className: 'dmg-read-more' })}>
            {'Read More: '}
            <a href={postUrl}>{postTitle}</a>
        </p>
    );
}
