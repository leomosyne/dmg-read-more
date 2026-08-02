import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';
import edit from './edit';
import './editor.scss';
import save from './save';
import './style.scss';

registerBlockType(metadata.name, {
    edit,
    save,
});
