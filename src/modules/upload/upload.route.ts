import { Hono } from 'hono';
import { handleConfirmUpload, handleSignUpload } from './upload.controller';

const upload = new Hono();

// TODO: Add auth middleware to protect upload routes.
upload.post('/sign', handleSignUpload);
upload.post('/confirm', handleConfirmUpload);

export default upload;
